/* ============================ CONFIGURATION CLIENT ============================
   Modelled on Commander's Config Client and Passport's Manager Workstation:
   every domain is its own form over its own table, and nothing here knows
   anything about the register's rendering.
   ========================================================================== */
let TAB="home";
/* Modules the owner switched on get their own tab, named for what they are.
   Everything else stays out of the way. */
/* Eighteen tabs in a scrolling strip meant nobody could find anything and
   everybody felt behind. They're the same eighteen screens, grouped the way a
   shop owner would think about them, with the ones most people never touch put
   somewhere you have to go looking. */
const CGROUPS=[
 {n:"What you sell",d:"Products, prices and how they're grouped",
  tabs:[["pricebook","Pricebook","Every product, its price and its cost"],
        ["depts","Departments","The buckets that carry tax and drive reports"],
        ["mods","Options","Sizes, milks, toppings — the questions asked at the till"],
        ["promos","Deals","Mix-and-match and automatic discounts"]]},
 {n:"Getting products in",d:"Load a pricebook or read it off an invoice",
  tabs:[["import","Import a file","CSV, spreadsheet or NAXML from another system"],
        ["invoice","Invoice intake","Photograph an invoice and pull costs off it"],
        ["stock","Stock","What's on hand, receiving, counts and what to order"],
        ["purchasing","Vendors & orders","Who you buy from, and what's on its way"]]},
 {n:"The register",d:"What the cashier sees and can do",
  tabs:[["menus","Menu designer","Arrange the keys, sizes and colours"],
        ["look","Appearance","Layout, colours, spacing"],
        ["mops","Payment methods","Cash, card, EBT, gift cards"],
        ["restricts","Age & time rules","ID checks and hours when things can't be sold",
          ()=>CFG.caps.includes("age")||CFG.restricts.length>0],
        ["reasons","Reason codes","Why a void, a refund or a payout happened"],
        ["terminals","Registers","Every lane in this store, and the drawers under the shift"],
        ["loyalty","Loyalty","Points, offers and who keeps coming back"],
        ["tobacco","Tobacco scan data","Buydowns, and what the manufacturers owe you"],
        ["central","Central pricebook","One price list pushed to many stores"],
        ["services2","Forecourt services","Money orders, lottery payouts and bill pay"],
        ["journal","Electronic journal","Search every sale this store has ever taken"],
        ["reports2","Reports","When you're busy, what makes money, who's selling it"]]},
 {n:"Your people",d:"Who can do what",
  tabs:[["people","Staff & permissions","Names, codes and what each role can reach"]]},
 {n:"The business",d:"Tax, receipts and your data",
  tabs:[["site","Store & tax","Name, address, tax rates, receipt"],
        ["hardware","Hardware & payments","Printer, drawer, card reader"],
        ["retention","Data & records","How long sales history is kept, and what happens before it goes"],
        ["health","Health check","What's misconfigured, in plain language"],
        ["account","Account & data","Export, delete, sign-in"]]},
 {n:"Features",d:"Switch on what your trade needs",
  tabs:[["modules","Add features","Everything available, on or off"]]},
 {n:"Ask",d:"Describe a change and approve it",
  tabs:[["ai","Ask for changes","Bulk edits in plain language"]]}
];
function ctabs(){
  /* A clothing shop has no business being shown age restrictions. Anything with
     a condition attached only appears when it applies — and can always be
     switched on under Add features. */
  const g=CGROUPS.map(x=>({...x,tabs:x.tabs.filter(t=>!t[3]||t[3]())}));
  /* Modules that are on get a home under Features, named for what they are. */
  const mods=Object.keys(MODULES).filter(modOn).map(k=>["mod_"+k,
    k==="records"?(listsCfg().lists[0]?.n||MODULES[k].n):MODULES[k].n,MODULES[k].what]);
  const feat=g.find(x=>x.n==="Features");
  feat.tabs=[...mods,...feat.tabs];
  return g;
}
const allTabs=()=>ctabs().flatMap(g=>g.tabs.map(t=>({...{k:t[0],n:t[1],d:t[2]},group:g.n})));
const W={};window.__w=W;

let CQ="";
function drawConfig(){
  const groups=ctabs();
  const q=CQ.trim().toLowerCase();
  const match=t=>!q||t[1].toLowerCase().includes(q)||(t[2]||"").toLowerCase().includes(q);
  const shown=groups.map(g=>({...g,tabs:g.tabs.filter(match)})).filter(g=>g.tabs.length);
  const here=allTabs().find(t=>t.k===TAB);

  $("vConfig").innerHTML=`
    <div class="cfgwrap">
      <aside class="cfgnav">
        <button class="cfghome ${TAB==="home"?"on":""}" onclick="__w.tab('home')">
          <svg viewBox="0 0 24 24"><path d="M3 11l9-8 9 8M6 10v10h12V10"/></svg>All settings</button>
        <div class="cfgsearch">
          <input id="cfgQ" placeholder="Search settings" value="${esc(CQ)}">
        </div>
        ${shown.map(g=>`<div class="cfggroup">
          <div class="cfggh">${esc(g.n)}</div>
          ${g.tabs.map(t=>`<button class="cfgt ${TAB===t[0]?"on":""}" data-k="${t[0]}"
            data-d="${esc(t[2]||"")}" onclick="__w.tab('${t[0]}')">${esc(t[1])}</button>`).join("")}
        </div>`).join("")||`<div class="cfgnone">Nothing matches “${esc(CQ)}”.</div>`}
      </aside>
      <section class="cfgmain">
        ${TAB==="home"?"":`<div class="cfghead">
          <div><h2>${esc(here?here.n:"Configuration")}</h2>
            <p>${esc(here?here.d:"")}</p></div>
        </div>`}
        <div class="edwrap" id="cfgBody"></div>
      </section>
    </div>`;

  /* Re-rendering the sidebar on every keystroke made it blink and lose focus.
     Typing filters in place; picking a screen only swaps the content. */
  W.tab=k=>{
    TAB=k;
    document.querySelectorAll("#vConfig .cfgt").forEach(b=>
      b.classList.toggle("on",b.dataset.k===k));
    const home=document.querySelector("#vConfig .cfghome");
    if(home)home.classList.toggle("on",k==="home");
    const head=document.querySelector("#vConfig .cfghead");
    const t=allTabs().find(x=>x.k===k);
    if(head&&t)head.innerHTML=`<div><h2>${esc(t.n)}</h2><p>${esc(t.d)}</p></div>`;
    if(head)head.style.display=k==="home"?"none":"";
    drawBody();
  };
  const s=$("cfgQ");
  if(s)s.oninput=e=>{
    CQ=e.target.value;
    const q=CQ.trim().toLowerCase();
    document.querySelectorAll("#vConfig .cfgt").forEach(b=>{
      const hit=!q||b.textContent.toLowerCase().includes(q)||(b.dataset.d||"").toLowerCase().includes(q);
      b.style.display=hit?"":"none";
    });
    document.querySelectorAll("#vConfig .cfggroup").forEach(g=>{
      const any=[...g.querySelectorAll(".cfgt")].some(b=>b.style.display!=="none");
      g.style.display=any?"":"none";
    });
  };

  drawBody();
}
function drawBody(){
  if(TAB==="home")return cfgHome();
  const views={import:importView,invoice:invoiceView,pricebook:tPricebook,depts:tDepts,
    menus:tMenus,mods:tMods,mops:tMops,restricts:tRestricts,promos:tPromos,people:tPeople,
    reasons:tReasons,site:tSite,look:tLook,hardware:tHardware,health:tHealth,
    account:tAccount,ai:tAI,modules:tModules,retention:tRetention,
    mod_records:tRecords,mod_expiry:tExpiry,mod_staff:tStaff,
    mod_customers:tCustomers,mod_tips:tTips,mod_giftcards:tGiftcards,mod_waste:tWaste,
    mod_commission:tCommission,mod_jobs:tJobs,mod_service:tService,mod_tanks:tTanks,
    journal:tJournal,stock:tStock,terminals:tTerminals,reports2:tReports2,
    purchasing:tPurchasing,loyalty:tLoyalty,tobacco:tTobacco,central:tCentral,
    services2:tServices2};
  (views[TAB]||cfgHome)();
}

/* The landing page. Everything at once, but arranged and explained, so the
   first visit is orienting rather than a wall of nouns. */
function cfgHome(){
  const f=typeof health==="function"?health():[];
  const bad=f.filter(x=>x.sev==="block").length,warn=f.filter(x=>x.sev==="warn").length;
  $("cfgBody").innerHTML=`
    <div class="cfghero">
      <h2>Settings</h2>
      <p>Everything about how this register behaves. Nothing here is permanent — change it,
        see what happens, change it back.</p>
      ${bad||warn?`<button class="cfgalert ${bad?"bad":"warn"}" onclick="__w.tab('health')">
        <b>${bad?`${bad} thing${bad===1?"":"s"} would break a sale`
          :`${warn} thing${warn===1?"":"s"} worth fixing`}</b>
        <span>Open the health check</span></button>`
        :`<div class="cfgok"><b>Everything checks out</b>
          <span>No misconfiguration found</span></div>`}
    </div>
    ${ctabs().map(g=>`
      <div class="cfgsect">
        <div class="cfgsh"><b>${esc(g.n)}</b><em>${esc(g.d)}</em></div>
        <div class="cfgcards">${g.tabs.map(t=>`
          <button class="cfgcard" onclick="__w.tab('${t[0]}')">
            <b>${esc(t[1])}</b><span>${esc(t[2]||"")}</span></button>`).join("")}</div>
      </div>`).join("")}`;
}

/* Everything on offer, on or off, describable. Nothing here is generated — each
   one is a built feature, so switching it on is safe and switching it off loses
   nothing but the tab. */
let RET_STATE=null;
async function tRetention(){
  $("cfgBody").innerHTML=`<p class="lede">Checking your current policy…</p>`;
  try{ RET_STATE=await api("/api/retention?store="+STORE_ID); }
  catch(e){ $("cfgBody").innerHTML=`<div class="finding"><b>Couldn't load this</b>
    <span>${esc(e.message)}</span></div>`; return; }
  drawRetention();
}
function drawRetention(){
  const {policy:p,preview:pv,history:hist}=RET_STATE;
  const wipe=p.mode==="wipe";

  W.retMode=m=>{RET_STATE.policy.mode=m;drawRetention()};
  W.retDays=d=>{RET_STATE.policy.days=parseInt(d)||90;drawRetention()};
  W.retMail=v=>{RET_STATE.policy.email=v};
  W.retSave=async()=>{
    const p=RET_STATE.policy;
    try{
      const r=await api("/api/retention?store="+STORE_ID,{method:"PUT",
        body:{store:STORE_ID,mode:p.mode,days:p.days,email:p.email,exportFirst:true}});
      RET_STATE.policy=r.policy;RET_STATE.preview=r.preview;drawRetention();
      toast(p.mode==="wipe"
        ?`Records will be deleted after <b>${p.days} days</b>.`
        :"Everything will be kept.");
    }catch(e){ toast(e.message,true) }
  };
  W.retRun=()=>{
    const el=veil(`<div class="card"><h3>Delete now</h3>
      <p>This removes ${pv.sales||0} sale${pv.sales===1?"":"s"} and ${pv.shifts||0} shift${
        pv.shifts===1?"":"s"} older than ${p.days} days. A copy is written first. Your pricebook,
        staff and settings are not affected.</p>
      <p style="margin-top:10px">Type <b>WIPE</b> to confirm.</p>
      <input id="rwv" class="big" style="text-align:center;letter-spacing:.2em">
      <div class="row"><button class="no" id="rwn">Cancel</button>
        <button class="danger" id="rwy">Delete them</button></div></div>`);
    const inp=el.querySelector("#rwv");inp.focus();
    el.querySelector("#rwn").onclick=()=>el.remove();
    el.querySelector("#rwy").onclick=async()=>{
      if(inp.value.trim().toUpperCase()!=="WIPE")return;
      el.remove();
      try{
        const r=await api("/api/retention/run?store="+STORE_ID,{method:"POST",
          body:{store:STORE_ID,confirm:"WIPE"}});
        toast(r.error?esc(r.error):r.skipped?esc(r.skipped)
          :`Removed <b>${r.sales}</b> sales and <b>${r.shifts}</b> shifts.`, !!r.error);
        tRetention();
      }catch(e){ toast(e.message,true) }
    };
  };

  $("cfgBody").innerHTML=`
    <p class="lede">Your sales and shift history live on the server so reports work and a shift can be
      re-read. If you'd rather that history didn't sit there indefinitely, set a window and it gets
      deleted on a schedule — whether or not anyone opens this terminal.</p>

    <div class="retpick">
      <button class="rp ${!wipe?"on":""}" onclick="__w.retMode('keep')">
        <b>Keep everything</b>
        <span>Reports go back as far as you've traded. Backed up nightly.</span></button>
      <button class="rp ${wipe?"on":""}" onclick="__w.retMode('wipe')">
        <b>Delete after a while</b>
        <span>Anything older than your window is removed for good.</span></button>
    </div>

    ${wipe?`
      <div class="sect">Keep records for</div>
      <div class="stchips">${[[7,"A week"],[30,"A month"],[90,"Three months"],[180,"Six months"],
        [365,"A year"],[730,"Two years"]].map(([d,n])=>
        `<button class="${p.days===d?"on":""}" onclick="__w.retDays(${d})">${n}</button>`).join("")}</div>
      <div class="frm" style="margin-top:11px">
        <label>Or a number of days
          <input class="n" value="${p.days}" oninput="__w.retDays(this.value)"></label>
        <label>Email a copy first
          <input value="${esc(p.email||"")}" placeholder="you@yourshop.com"
            oninput="__w.retMail(this.value)"></label>
      </div>
      ${!pv.mailReady&&p.email?`<div class="note" style="border-color:var(--warn)">
        No outgoing mail service is configured on this server, so nothing can be emailed yet.
        The copy is still written and stays downloadable below. Set <span class="num">SMTP_URL</span>
        in your environment to turn email on.</div>`:""}

      <div class="retnext">
        <div><b class="num">${pv.sales||0}</b><span>sales would go now</span></div>
        <div><b class="num">${pv.kept||0}</b><span>would be kept</span></div>
        <div><b>${pv.oldest?esc(String(pv.oldest).slice(0,10)):"\u2014"}</b><span>oldest on file</span></div>
      </div>

      <div class="keepwhat" style="margin-top:16px">
        <div class="kw go"><b>Deleted</b><span>Sales, shift history, card payment references</span></div>
        <div class="kw no"><b>Never touched</b><span>Pricebook, departments, tax rates, staff, layout,
          customers you've saved</span></div>
      </div>`:""}

    <div class="row" style="margin-top:18px">
      <button class="mini ok" style="color:#0D1F18" onclick="__w.retSave()">Save this policy</button>
      ${wipe&&pv.sales?`<button class="mini" style="border-color:var(--void);color:var(--void)"
        onclick="__w.retRun()">Delete the ${pv.sales} now</button>`:""}
    </div>

    ${hist&&hist.length?`
      <div class="sect">What's been deleted</div>
      <table class="tbl"><thead><tr><th>When</th><th>Window</th><th>Sales</th><th>Shifts</th>
        <th>Copy</th></tr></thead><tbody>
        ${hist.map(h=>`<tr>
          <td style="padding-left:9px;color:var(--txt-2)">${esc(String(h.at).slice(0,16))}</td>
          <td style="padding-left:9px" class="num">${h.kept_days}d</td>
          <td style="padding-left:9px" class="num">${h.sales}</td>
          <td style="padding-left:9px" class="num">${h.shifts}</td>
          <td style="padding-left:9px">${h.file
            ? `<a href="/api/retention/export/${encodeURIComponent(h.file)}?store=${STORE_ID}"
                 class="dl">Download</a>${h.emailed?" · emailed":""}`
            : `<span style="color:var(--txt-3)">none</span>`}</td></tr>`).join("")}
      </tbody></table>`:""}

    <div class="note">A copy is always written before anything is removed. If that copy can't be
      written, the deletion is abandoned — losing records because a backup failed is the one outcome
      that would be unforgivable. Open shifts are never deleted regardless of the window.</div>`;
}

function tModules(){
  W.togMod=id=>{setModule(id,!modOn(id));refresh();reload();queueSave();
    toast(modOn(id)?`<b>${esc(MODULES[id].n)}</b> switched on.`:`${esc(MODULES[id].n)} switched off.`)};
  $("cfgBody").innerHTML=`
    <p class="lede" style="margin:0 0 4px">Switch on what your trade needs. Each one adds its own tab
      and nothing else — turning one off later leaves its records intact in case you want it back.</p>
    <div class="modgrid">${Object.entries(MODULES)
      .map(([id,m])=>[id,m,modOn(id)?2:(m.fits.test((A.type||"")+" "+(A.desc||""))?1:0)])
      .sort((a,b)=>b[2]-a[2])
      .map(([id,m,rank])=>`
      <button class="modcard ${modOn(id)?"on":""}" onclick="__w.togMod('${id}')">
        <svg viewBox="0 0 24 24">${m.icon}</svg>
        <b>${esc(m.n)}</b>
        <span>${esc(m.what)}</span>
        <em>${modOn(id)?"On":rank?"Suggested":"Off"}</em>
      </button>`).join("")}</div>
    ${CFG.trade?.length?`<div class="sect">What you told me at setup</div>
      <div class="rpt">${CFG.trade.map(t=>
        `<div class="rr"><span>${esc(t.q)}</span><b style="font-size:13px">${esc(t.a||"—")}</b></div>`).join("")}</div>`:""}
    <div class="note">More are coming — customer contact capture, commission tracking, and
      appointment booking are the next three. If your trade needs something that isn't here, say so.</div>`;
}
const refresh=()=>{drawConfig()};
const reload=()=>{renderTenders();drawMenus();drawGrid();drawCart()};

/* Grouping. A flat list of two hundred products is a spreadsheet, not a
   pricebook. Items cluster by brand far more often than not — every Coke
   variant starts with "Coca-Cola" — so a leading-token key gets most of the way
   there with no model call. Anything the heuristic can't place sits in "Other"
   until someone runs Auto-organise, which asks the model and stores the answer
   on the product. */
const SIZE_TOK=/^(\d+(\.\d+)?)\s*(oz|z|ml|l|lb|lbs|g|ct|pk|pack|count|liter|litre|gal|qt|pt|in|ft|mg)?$/i;
const LEAD_PAIR=/^(dr|mt|mtn|jack|coca|diet|red|arizona|monster|old|big|little|hot|sweet|nice|good|great|king|new)$/i;
const STOPW=new Set(["the","and","with","of","in","a","an","for"]);
function autoGroup(name){
  const raw=String(name||"").replace(/\(.*?\)/g," ").replace(/[^\w\s'&.-]/g," ").trim();
  const toks=raw.split(/[\s\-–—,\/]+/).filter(t=>t&&!SIZE_TOK.test(t)&&!STOPW.has(t.toLowerCase()));
  if(!toks.length)return "Other";
  let k=toks[0].replace(/'s$/i,"");
  if(toks[1]&&(k.length<=3||LEAD_PAIR.test(k)))k=k+" "+toks[1].replace(/'s$/i,"");
  return k.replace(/\.$/,"");
}
function groupsFor(deptId){
  const items=CFG.plus.filter(p=>p.deptId===deptId);
  const map={};
  items.forEach(p=>{
    const g=(p.grp&&p.grp.trim())||autoGroup(p.n);
    (map[g]=map[g]||[]).push(p);
  });
  /* One-off products don't deserve a heading of their own. */
  const out=[],singles=[];
  Object.entries(map).sort((a,b)=>a[0].localeCompare(b[0])).forEach(([g,list])=>{
    if(list.length>1)out.push([g,list.sort((x,y)=>x.n.localeCompare(y.n))]);
    else singles.push(list[0]);
  });
  if(singles.length)out.push(["Everything else",singles.sort((x,y)=>x.n.localeCompare(y.n))]);
  return out;
}

let PB_OPEN=null,PB_Q="";
function tPricebook(){
  W.set=(id,f,v)=>{const p=byId(CFG.plus,id);
    p[f]=f==="price"?(parseFloat(v)||0):(f==="restrictId"?(v||null):v);reload()};
  W.chk=(id,f,v)=>{byId(CFG.plus,id)[f]=v;reload()};
  W.delP=id=>{CFG.plus=CFG.plus.filter(p=>p.id!==id);
    CFG.menus.forEach(m=>m.keys=m.keys.filter(k=>k.pluId!==id));refresh();reload()};
  W.addP=d=>{const dept=byId(CFG.depts,d)||CFG.depts.find(x=>!x.fuel);
    const p={id:"P"+uid(),upc:"",n:"New item",price:0,deptId:dept.id,weighed:false,ebt:false,
      deposit:null,restrictId:null,modIds:[]};
    CFG.plus.push(p);const m=CFG.menus.find(x=>x.id==="M"+dept.id);m&&m.keys.push({pluId:p.id});
    PB_OPEN=dept.id;refresh();reload()};
  W.pbOpen=d=>{PB_OPEN=PB_OPEN===d?null:d;refresh()};
  W.pbQ=v=>{PB_Q=v;const el=$("pbList");if(el)el.innerHTML=pbBody()};
  W.setGrp=(id,v)=>{byId(CFG.plus,id).grp=v.trim()||null};
  W.modP=id=>{
    const p=byId(CFG.plus,id);
    const el=veil(`<div class="card"><h3>Options on ${esc(p.n)}</h3>
      <p>Which modifier groups prompt when this item is rung.</p>
      <div class="opts" style="flex-direction:column">${CFG.modGroups.map(g=>
        `<button data-g="${g.id}" style="width:100%;${p.modIds?.includes(g.id)?"background:rgba(92,224,168,.16);border-color:var(--vfd)":""}">
          ${esc(g.n)} <span style="color:var(--txt-3);font-size:12px">· ${g.required?"required":"optional"}</span></button>`).join("")
        ||`<p style="color:var(--txt-3)">No modifier groups yet. Create one under Modifiers.</p>`}</div>
      <div class="row"><button class="no" id="mn">Done</button></div></div>`);
    el.querySelectorAll("[data-g]").forEach(b=>b.onclick=()=>{
      p.modIds=p.modIds||[];const i=p.modIds.indexOf(b.dataset.g);
      i<0?p.modIds.push(b.dataset.g):p.modIds.splice(i,1);
      el.remove();W.modP(id);refresh();reload()});
    el.querySelector("#mn").onclick=()=>el.remove();
  };
  W.confirm=()=>{
    const queue=CFG.plus.filter(p=>p.upcSrc==="lookup");let n=0;
    const step=()=>{
      const p=queue[n];
      if(!p){refresh();return toast("All looked-up barcodes checked.")}
      const el=veil(`<div class="card"><h3>Scan ${esc(p.n)}</h3>
        <p>${n+1} of ${queue.length}. Scan the product, or type its barcode. We think it's
          <b class="num">${esc(p.upc)}</b>, but that came from a lookup rather than the package.</p>
        <input id="cfv" class="big num" placeholder="scan now">
        <div id="cfr" style="margin-top:12px;font-size:13px;color:var(--txt-2)"></div>
        <div class="row"><button class="no" id="cfskip">Skip</button>
          <button class="ok" id="cfstop">Stop</button></div></div>`);
      const inp=el.querySelector("#cfv");inp.focus();
      inp.onkeydown=e=>{
        if(e.key!=="Enter")return;
        const got=validUPC(inp.value);
        if(!got){el.querySelector("#cfr").innerHTML=
          `<span style="color:var(--void)">Not a valid barcode — the check digit doesn't match.</span>`;
          inp.value="";return}
        if(got===p.upc){p.upcSrc="scanned";
          el.querySelector("#cfr").innerHTML=`<span style="color:var(--vfd)">Matches. Confirmed.</span>`}
        else{p.upc=got;p.upcSrc="scanned";
          el.querySelector("#cfr").innerHTML=`<span style="color:var(--warn)">Different — corrected to ${got}.</span>`}
        setTimeout(()=>{el.remove();n++;step()},700);
      };
      el.querySelector("#cfskip").onclick=()=>{el.remove();n++;step()};
      el.querySelector("#cfstop").onclick=()=>{el.remove();refresh()};
    };
    step();
  };
  /* Ask the model to name the shelf groupings, then keep the answer. */
  W.organise=async()=>{
    const btn=$("pbOrg");if(btn){btn.disabled=true;btn.textContent="Organising…"}
    for(const d of CFG.depts.filter(x=>!x.fuel)){
      const items=CFG.plus.filter(p=>p.deptId===d.id);
      if(items.length<3)continue;
      try{
        const r=await callAI(`Group these products from the "${d.n}" section of a convenience store the way
they'd sit together on a shelf. Brand families belong together — every Coca-Cola variant in one group,
every Lay's in another. Where products share no brand, group by what they are: "Bottled water",
"Energy drinks", "Candy bars".

${items.map((p,i)=>`${i}. ${p.n}`).join("\n")}

Return ONLY valid JSON, no prose or fences:
{"groups":[{"i":number,"g":string}]}

- "g" is a short group label, two or three words at most.
- Every product gets exactly one group. Aim for groups of 2 or more; use "Everything else"
  for genuine one-offs.`,{max_tokens:1800,kind:"organise"});
        (r.groups||[]).forEach(x=>{const p=items[x.i];if(p&&x.g)p.grp=String(x.g).slice(0,40)});
      }catch(e){}
    }
    refresh();reload();toast("Pricebook organised into shelf groups.");
  };

  const unconf=CFG.plus.filter(p=>p.upcSrc==="lookup").length;
  const starters=CFG.plus.filter(p=>p.starter).length;
  W.clearStarters=()=>{
    const el=veil(`<div class="card"><h3>Remove the example products</h3>
      <p>${starters} products were generated as illustrations when this store was set up. They have
        made-up prices and made-up barcodes. Removing them leaves your departments and settings intact.</p>
      <div class="row"><button class="no" id="csn">Keep them</button>
        <button class="danger" id="csy">Remove all ${starters}</button></div></div>`);
    el.querySelector("#csn").onclick=()=>el.remove();
    el.querySelector("#csy").onclick=()=>{
      const ids=CFG.plus.filter(p=>p.starter).map(p=>p.id);
      CFG.plus=CFG.plus.filter(p=>!p.starter);
      CFG.menus.forEach(m=>m.keys=m.keys.filter(k=>!ids.includes(k.pluId)));
      CFG.promos=(CFG.promos||[]).filter(pr=>{
        pr.pluIds=pr.pluIds.filter(id=>!ids.includes(id));return pr.pluIds.length});
      el.remove();refresh();reload();
      toast(`Removed <b>${ids.length}</b> example product${ids.length===1?"":"s"}.`);
    };
  };
  $("cfgBody").innerHTML=`
    ${starters?`<div class="verify"><div class="vhead">${starters} example products in here</div>
      <p>These were generated when the store was set up. The prices and barcodes are invented — don't
        sell from them. Import your real pricebook or read in an invoice, then clear these out.</p>
      <div class="vact">
        <button class="mini" onclick="__w.clearStarters()">Remove the examples</button>
        <button class="mini" onclick="TAB='import';drawConfig()">Import my pricebook</button>
      </div></div>`:""}
    <div class="pbtop">
      <input id="pbSearch" placeholder="Find a product, barcode or brand…" value="${esc(PB_Q)}">
      <button class="mini" style="margin:0" id="pbOrg" onclick="__w.organise()">Auto-organise</button>
      ${unconf?`<button class="mini" style="margin:0" onclick="__w.confirm()">Confirm ${unconf} barcode${unconf===1?"":"s"}</button>`:""}
    </div>
    <div id="pbList">${pbBody()}</div>
    <div class="note">Departments are the accounting buckets; the groups inside them are just how the
      shelf reads. Renaming a group moves nothing — it only changes where the row sits on this screen.</div>`;
  const si=$("pbSearch");
  si.oninput=e=>W.pbQ(e.target.value);
}
function pbBody(){
  const q=PB_Q.trim().toLowerCase();
  if(q){
    const hits=CFG.plus.filter(p=>p.n.toLowerCase().includes(q)||(p.upc||"").includes(q)
      ||((p.grp||autoGroup(p.n)).toLowerCase().includes(q)));
    return hits.length
      ? `<div class="pbgroup"><div class="pbgh">${hits.length} match${hits.length===1?"":"es"}</div>
          ${pbRows(hits,true)}</div>`
      : `<p style="color:var(--txt-3);font-size:13px;padding:14px 2px">Nothing matches “${esc(q)}”.</p>`;
  }
  return CFG.depts.filter(d=>!d.fuel).map(d=>{
    const groups=groupsFor(d.id),n=CFG.plus.filter(p=>p.deptId===d.id).length;
    const open=PB_OPEN===d.id;
    return `<div class="pbdept ${open?"open":""}">
      <button class="pbhead" onclick="__w.pbOpen('${d.id}')">
        <span class="caret">${open?"▾":"▸"}</span>
        <span class="swatch2" style="background:${d.color}"></span>
        <b>${esc(d.n)}</b>
        <span class="pbmeta">${n} item${n===1?"":"s"} · ${groups.length} group${groups.length===1?"":"s"}
          · ${esc(byId(CFG.taxRates,d.taxId)?.n||"no tax rate")}</span>
      </button>
      ${open?`<div class="pbbody">
        ${groups.map(([g,list])=>`<div class="pbgroup">
          <div class="pbgh">${esc(g)}<span>${list.length}</span></div>
          ${pbRows(list)}</div>`).join("")
          ||`<p style="color:var(--txt-3);font-size:13px;padding:10px 2px">Nothing in this department yet.</p>`}
        <button class="mini" onclick="__w.addP('${d.id}')">Add an item to ${esc(d.n)}</button>
      </div>`:""}
    </div>`;
  }).join("");
}
function pbRows(list,showDept){
  return `<table class="tbl pbtbl"><thead><tr>
    <th style="width:26%">Item</th><th style="width:14%">Barcode</th><th style="width:9%">Cost</th>
    <th style="width:9%">Price</th><th style="width:7%">Margin</th>
    ${showDept?`<th style="width:12%">Department</th>`:`<th style="width:12%">Group</th>`}
    <th style="width:13%">Restriction</th><th>Opts</th><th>lb</th><th>EBT</th><th></th></tr></thead><tbody>
  ${list.map(p=>`<tr>
    <td><input value="${esc(p.n)}" oninput="__w.set('${p.id}','n',this.value)"></td>
    <td><input class="n upc-${p.upcSrc||"none"}" value="${esc(p.upc||"")}"
      oninput="__w.set('${p.id}','upc',this.value)"></td>
    <td><input class="n" value="${p.cost?money(p.cost):""}" placeholder="—"
      oninput="__w.set('${p.id}','cost',parseFloat(this.value)||0)"></td>
    <td><input class="n" value="${money(p.price)}" oninput="__w.set('${p.id}','price',this.value)"></td>
    <td style="padding-left:7px;color:var(--txt-2);font-size:12px">${
      p.cost>0?marginOf(p.cost,p.price).toFixed(0)+"%":"—"}</td>
    ${showDept
      ? `<td><select onchange="__w.set('${p.id}','deptId',this.value)">${CFG.depts.filter(d=>!d.fuel).map(d=>
          `<option value="${d.id}" ${p.deptId===d.id?"selected":""}>${esc(d.n)}</option>`).join("")}</select></td>`
      : `<td><input value="${esc(p.grp||autoGroup(p.n))}" oninput="__w.setGrp('${p.id}',this.value)"></td>`}
    <td><select onchange="__w.set('${p.id}','restrictId',this.value)"><option value="">None</option>${
      CFG.restricts.map(r=>`<option value="${r.id}" ${p.restrictId===r.id?"selected":""}>${esc(r.n)}</option>`).join("")}</select></td>
    <td><button class="mini" style="margin:0;padding:5px 8px;font-size:11.5px" onclick="__w.modP('${p.id}')">${p.modIds?.length||0}</button></td>
    <td><input type="checkbox" ${p.weighed?"checked":""} onchange="__w.chk('${p.id}','weighed',this.checked)" style="width:auto"></td>
    <td><input type="checkbox" ${p.ebt?"checked":""} onchange="__w.chk('${p.id}','ebt',this.checked)" style="width:auto"></td>
    <td><button class="del" onclick="__w.delP('${p.id}')" aria-label="Delete">×</button></td></tr>`).join("")}
  </tbody></table>`;
}
function tDepts(){
  W.setD=(id,f,v)=>{byId(CFG.depts,id)[f]=v;reload()};
  W.colD=(id,ci)=>{byId(CFG.depts,id).color=PALETTE[ci];
    const m=CFG.menus.find(x=>x.id==="M"+id);if(m)m.color=PALETTE[ci];refresh();reload()};
  W.delD=id=>{if(CFG.plus.some(p=>p.deptId===id))
      return alertCard("Department not empty","Move or delete this department's items first. Products can't be orphaned from their tax bucket.");
    CFG.depts=CFG.depts.filter(d=>d.id!==id);refresh();reload()};
  W.addD=()=>{CFG.depts.push({id:"D"+uid(),n:"New department",taxId:"TX1",food:false,
    color:PALETTE[CFG.depts.length%PALETTE.length]});refresh();reload()};
  $("cfgBody").innerHTML=`<table class="tbl"><thead><tr>
      <th style="width:36%">Department</th><th style="width:24%">Tax rate</th>
      <th style="width:14%">Items</th><th>Colour</th><th></th></tr></thead><tbody>
    ${CFG.depts.map(d=>`<tr>
      <td><input value="${esc(d.n)}" ${d.fuel?"readonly":""} oninput="__w.setD('${d.id}','n',this.value)"></td>
      <td><select onchange="__w.setD('${d.id}','taxId',this.value)">${CFG.taxRates.map(r=>
        `<option value="${r.id}" ${d.taxId===r.id?"selected":""}>${esc(r.n)} ${r.rate}%</option>`).join("")}</select></td>
      <td style="padding-left:9px;color:var(--txt-2)">${CFG.plus.filter(p=>p.deptId===d.id).length}</td>
      <td><div class="swatches">${PALETTE.map((c,ci)=>
        `<button class="${d.color===c?"on":""}" style="background:${c}" onclick="__w.colD('${d.id}',${ci})" aria-label="Colour"></button>`).join("")}</div></td>
      <td>${d.fuel?"":`<button class="del" onclick="__w.delD('${d.id}')" aria-label="Delete">×</button>`}</td></tr>`).join("")}
    </tbody></table><button class="mini" onclick="__w.addD()">Add a department</button>
    <div class="note">Departments are accounting buckets, not screens. They drive tax and the department sales
      report. What the cashier actually sees lives under Menus.</div>`;
}
/* The menu designer.

   Presets get a store to something usable in a minute. This is what makes it
   theirs: keys can be dragged into any order, made double-width or double-height
   so the things sold forty times an hour are the easiest to hit, given their own
   colour, and relabelled without touching the product's real name. */
let MENU_EDIT=null;
function tMenus(){
  const menus=CFG.menus;
  const cur=menus.find(m=>m.id===MENU_EDIT)||menus[0];
  if(cur)MENU_EDIT=cur.id;

  W.setM=(id,v)=>{menus.find(m=>m.id===id).n=v;reload();queueSave()};
  W.pickMenu=id=>{MENU_EDIT=id;refresh()};
  W.addM=()=>{const m={id:"M"+uid(),n:"New menu",color:PALETTE[menus.length%PALETTE.length],keys:[]};
    menus.push(m);MENU_EDIT=m.id;refresh();reload()};
  W.delM=id=>{CFG.menus=menus.filter(m=>m.id!==id);MENU_EDIT=null;MENU=0;refresh();reload()};
  W.addK=(mid,pid)=>{if(!pid)return;
    menus.find(m=>m.id===mid).keys.push({pluId:pid});refresh();reload()};
  W.delK=(mid,i)=>{menus.find(m=>m.id===mid).keys.splice(i,1);refresh();reload()};
  /* Size is stored on the key, not the product — the same coffee can be a big
     key on the morning menu and a small one on the evening board. */
  W.keySize=(mid,i,w,h)=>{const k=menus.find(m=>m.id===mid).keys[i];
    k.w=w;k.h=h;refresh();reload();queueSave()};
  W.keyColor=(mid,i,col)=>{const k=menus.find(m=>m.id===mid).keys[i];
    k.color=col||null;refresh();reload();queueSave()};
  W.keyLabel=(mid,i,v)=>{const k=menus.find(m=>m.id===mid).keys[i];
    k.label=v.trim()||null;reload();queueSave()};
  W.moveK=(mid,from,to)=>{
    const ks=menus.find(m=>m.id===mid).keys;
    if(to<0||to>=ks.length||from===to)return;
    ks.splice(to,0,ks.splice(from,1)[0]);
    refresh();reload();queueSave();
  };
  W.autoFill=mid=>{
    const m=menus.find(x=>x.id===mid);
    const dept=CFG.depts.find(d=>"M"+d.id===mid);
    const have=new Set(m.keys.map(k=>k.pluId));
    const add=CFG.plus.filter(p=>(!dept||p.deptId===dept.id)&&!have.has(p.id));
    add.forEach(p=>m.keys.push({pluId:p.id}));
    refresh();reload();
    toast(`Added <b>${add.length}</b> key${add.length===1?"":"s"}.`);
  };

  const KEYCOLS=["#3E464A","#3A5A52","#57493B","#3D4D66","#573D4D","#485435","#4A3F5C","#2F4F55",
                 "#7A3B3B","#2E5F7A"];

  $("cfgBody").innerHTML=`
    <div class="listtabs">${menus.map(m=>
      `<button class="${m.id===MENU_EDIT?"on":""}" onclick="__w.pickMenu('${m.id}')">
        ${esc(m.n)}<em>${m.keys.length}</em></button>`).join("")}
      <button class="add" onclick="__w.addM()">+ New menu</button></div>

    ${!cur?`<p style="color:var(--txt-3);font-size:13px;padding:16px 2px">No menus yet.</p>`:`
      <div class="mdhead">
        <input value="${esc(cur.n)}" oninput="__w.setM('${cur.id}',this.value)" class="mdname">
        <button class="mini" style="margin:0" onclick="__w.autoFill('${cur.id}')">Add missing products</button>
        ${cur.fuel?"":`<button class="mini" style="margin:0;border-color:var(--void);color:var(--void)"
          onclick="__w.delM('${cur.id}')">Delete menu</button>`}
      </div>

      ${cur.fuel?`<div class="note">Pump tiles are generated from the fuel module and can't be
        rearranged here.</div>`:`
        <div class="mdboard" id="mdBoard">
          ${cur.keys.map((k,i)=>{
            const p=byId(CFG.plus,k.pluId);
            const d=p?byId(CFG.depts,p.deptId):null;
            const col=k.color||d?.color||"#3E464A";
            return `<div class="mdkey w${k.w||1} h${k.h||1}" draggable="true"
              data-i="${i}" style="background:linear-gradient(180deg,${col} 0%,${col}CC 120%)">
              <span class="mdlabel">${esc(k.label||p?.n||"(missing)")}</span>
              <span class="mdprice num">${p?money(p.price):"—"}</span>
              <span class="mdtools">
                <button title="Wider" onclick="__w.keySize('${cur.id}',${i},${(k.w||1)===2?1:2},${k.h||1})">${(k.w||1)===2?"◧":"◫"}</button>
                <button title="Taller" onclick="__w.keySize('${cur.id}',${i},${k.w||1},${(k.h||1)===2?1:2})">${(k.h||1)===2?"▤":"▥"}</button>
                <button title="Remove" onclick="__w.delK('${cur.id}',${i})">×</button>
              </span>
              <span class="mdswatches">${KEYCOLS.map(cc=>
                `<i style="background:${cc}" onclick="event.stopPropagation();__w.keyColor('${cur.id}',${i},'${cc}')"></i>`).join("")}
                <i class="clear" onclick="event.stopPropagation();__w.keyColor('${cur.id}',${i},'')" title="Use the department colour">↺</i></span>
            </div>`}).join("")
            ||`<div class="mdempty">Nothing on this menu yet. Add products below, or use
                 <b>Add missing products</b>.</div>`}
        </div>
        <div class="mdadd">
          <select onchange="__w.addK('${cur.id}',this.value);this.value=''">
            <option value="">Add a product to this menu…</option>
            ${CFG.plus.map(p=>`<option value="${p.id}">${esc(p.n)}</option>`).join("")}</select>
        </div>
        <div class="note">Drag a key to move it. The two buttons on each key make it double-width or
          double-height — put the six things you sell all day where a thumb lands without looking.
          Colour is per key, so the same product can be red on one menu and grey on another.
          Renaming a key changes the button, never the product.</div>`}`}`;

  /* Drag to rearrange. Plain HTML5 drag events — no library, works with a mouse
     and with a finger on the terminals that matter. */
  const board=$("mdBoard");
  if(board){
    let from=null;
    board.querySelectorAll(".mdkey").forEach(el=>{
      el.addEventListener("dragstart",e=>{from=+el.dataset.i;el.classList.add("dragging");
        e.dataTransfer.effectAllowed="move"});
      el.addEventListener("dragend",()=>{el.classList.remove("dragging");
        board.querySelectorAll(".mdkey").forEach(x=>x.classList.remove("over"))});
      el.addEventListener("dragover",e=>{e.preventDefault();el.classList.add("over")});
      el.addEventListener("dragleave",()=>el.classList.remove("over"));
      el.addEventListener("drop",e=>{e.preventDefault();
        const to=+el.dataset.i;
        if(from!=null&&from!==to)W.moveK(MENU_EDIT,from,to);
      });
      el.addEventListener("dblclick",()=>{
        const i=+el.dataset.i;
        const k=CFG.menus.find(m=>m.id===MENU_EDIT).keys[i];
        const p=byId(CFG.plus,k.pluId);
        ask({t:"Rename this key",p:`The product stays "${p?p.n:"—"}". This only changes what's
          printed on the button.`,yes:"Set it",done:()=>{}});
        const inp=document.querySelector(".veil .card input");
        if(inp){inp.type="text";inp.value=k.label||p?.n||"";inp.classList.remove("num");
          inp.style.textAlign="left";inp.focus();
          document.querySelector(".veil .card .ok").onclick=()=>{
            W.keyLabel(MENU_EDIT,i,inp.value);
            document.querySelector(".veil").remove();refresh()};}
      });
    });
  }
}

function tMods(){
  W.setG=(id,f,v)=>{const g=byId(CFG.modGroups,id);g[f]=v};
  W.setO=(gid,oi,f,v)=>{const g=byId(CFG.modGroups,gid);g.opts[oi][f]=f==="p"?(parseFloat(v)||0):v};
  W.delO=(gid,oi)=>{byId(CFG.modGroups,gid).opts.splice(oi,1);refresh()};
  W.addO=gid=>{byId(CFG.modGroups,gid).opts.push({n:"New option",p:0});refresh()};
  W.delG=id=>{CFG.modGroups=CFG.modGroups.filter(g=>g.id!==id);
    CFG.plus.forEach(p=>p.modIds=(p.modIds||[]).filter(x=>x!==id));refresh();reload()};
  W.addG=()=>{CFG.modGroups.push({id:"MG"+uid(),n:"New group",required:false,multi:true,
    opts:[{n:"Option",p:0}]});refresh()};
  $("cfgBody").innerHTML=(CFG.modGroups||[]).map(g=>`
    <div class="sect">Modifier group</div>
    <div class="frm">
      <label>Name<input value="${esc(g.n)}" oninput="__w.setG('${g.id}','n',this.value)"></label>
      <label>Behaviour<select onchange="__w.setG('${g.id}','required',this.value==='1')">
        <option value="0" ${!g.required?"selected":""}>Optional</option>
        <option value="1" ${g.required?"selected":""}>Required</option></select></label>
      <label>Selection<select onchange="__w.setG('${g.id}','multi',this.value==='1')">
        <option value="0" ${!g.multi?"selected":""}>Pick one</option>
        <option value="1" ${g.multi?"selected":""}>Pick any</option></select></label>
      <label style="flex:0 0 auto;align-self:flex-end">
        <button class="del" onclick="__w.delG('${g.id}')" style="padding:10px" aria-label="Delete group">×</button></label>
    </div>
    <table class="tbl" style="margin-top:8px"><thead><tr><th>Option</th><th style="width:110px">Price change</th><th style="width:36px"></th></tr></thead>
    <tbody>${g.opts.map((o,oi)=>`<tr>
      <td><input value="${esc(o.n)}" oninput="__w.setO('${g.id}',${oi},'n',this.value)"></td>
      <td><input class="n" value="${money(o.p||0)}" oninput="__w.setO('${g.id}',${oi},'p',this.value)"></td>
      <td><button class="del" onclick="__w.delO('${g.id}',${oi})" aria-label="Remove">×</button></td></tr>`).join("")}
    </tbody></table><button class="mini" onclick="__w.addO('${g.id}')">Add an option</button>`).join("")
    +`<div><button class="mini" onclick="__w.addG()">Add a modifier group</button></div>
      <div class="note">A required group blocks the sale until the cashier picks one — sizes, for instance.
        An optional multi-select group is for add-ons. Attach groups to items from the Options column
        in the Pricebook.</div>`;
}
function tMops(){
  W.setMop=(id,f,v)=>{byId(CFG.mops,id)[f]=v;reload()};
  W.delMop=id=>{CFG.mops=CFG.mops.filter(m=>m.id!==id);refresh();reload()};
  W.addMop=()=>{CFG.mops.push({id:"MOP"+uid(),n:"New tender",kind:"other",drawer:false,change:false});refresh();reload()};
  $("cfgBody").innerHTML=`<table class="tbl"><thead><tr>
      <th style="width:30%">Method of payment</th><th style="width:16%">Kind</th>
      <th>Opens drawer</th><th>Gives change</th><th>Rounds cash</th><th>EBT only</th><th></th></tr></thead><tbody>
    ${CFG.mops.map(m=>`<tr>
      <td><input value="${esc(m.n)}" oninput="__w.setMop('${m.id}','n',this.value)"></td>
      <td><select onchange="__w.setMop('${m.id}','kind',this.value)">${["cash","card","ebt","check","gift","house","other"].map(k=>
        `<option ${m.kind===k?"selected":""}>${k}</option>`).join("")}</select></td>
      <td><input type="checkbox" ${m.drawer?"checked":""} onchange="__w.setMop('${m.id}','drawer',this.checked)" style="width:auto"></td>
      <td><input type="checkbox" ${m.change?"checked":""} onchange="__w.setMop('${m.id}','change',this.checked)" style="width:auto"></td>
      <td><input type="checkbox" ${m.rounds?"checked":""} onchange="__w.setMop('${m.id}','rounds',this.checked)" style="width:auto"></td>
      <td><input type="checkbox" ${m.ebtOnly?"checked":""} onchange="__w.setMop('${m.id}','ebtOnly',this.checked)" style="width:auto"></td>
      <td><button class="del" onclick="__w.delMop('${m.id}')" aria-label="Delete">×</button></td></tr>`).join("")}
    </tbody></table><button class="mini" onclick="__w.addMop()">Add a method of payment</button>
    <div class="note">Tenders are rows in a table, not branches in code. Adding house accounts or gift cards
      is a configuration change, not a release.</div>`;
}
function tRestricts(){
  W.setR=(id,f,v)=>{const r=byId(CFG.restricts,id);r[f]=f==="minAge"?(parseInt(v)||0):v;reload()};
  W.delR=id=>{CFG.restricts=CFG.restricts.filter(r=>r.id!==id);
    CFG.plus.forEach(p=>{if(p.restrictId===id)p.restrictId=null});refresh();reload()};
  W.addR=()=>{CFG.restricts.push({id:"R"+uid(),n:"New restriction",minAge:21,idScan:true,start:"",end:""});refresh()};
  $("cfgBody").innerHTML=`<table class="tbl"><thead><tr>
      <th style="width:32%">Restriction</th><th style="width:12%">Min age</th>
      <th style="width:14%">Blocked from</th><th style="width:14%">until</th>
      <th style="width:11%">Items</th><th></th></tr></thead><tbody>
    ${CFG.restricts.map(r=>`<tr>
      <td><input value="${esc(r.n)}" oninput="__w.setR('${r.id}','n',this.value)"></td>
      <td><input class="n" value="${r.minAge||""}" oninput="__w.setR('${r.id}','minAge',this.value)"></td>
      <td><input class="n" value="${esc(r.start||"")}" placeholder="02:00" oninput="__w.setR('${r.id}','start',this.value)"></td>
      <td><input class="n" value="${esc(r.end||"")}" placeholder="07:00" oninput="__w.setR('${r.id}','end',this.value)"></td>
      <td style="padding-left:9px;color:var(--txt-2)">${CFG.plus.filter(p=>p.restrictId===r.id).length}</td>
      <td><button class="del" onclick="__w.delR('${r.id}')" aria-label="Delete">×</button></td></tr>`).join("")
      ||`<tr><td colspan="6" style="padding:11px;color:var(--txt-3)">No restrictions yet.</td></tr>`}
    </tbody></table><button class="mini" onclick="__w.addR()">Add a restriction</button>
    <div class="note">Leave the hours blank for an ID check with no time limit. Fill them in and the key greys
      out during that window — useful where alcohol can't be sold overnight.</div>`;
}
function tPromos(){
  W.setPr=(id,f,v)=>{const p=byId(CFG.promos,id);p[f]=(f==="qty"||f==="price")?(parseFloat(v)||0):v;reload()};
  W.togPr=(id,v)=>{byId(CFG.promos,id).on=v;reload()};
  W.delPr=id=>{CFG.promos=CFG.promos.filter(p=>p.id!==id);refresh();reload()};
  W.addPr=()=>{CFG.promos.push({id:"PR"+uid(),n:"New deal",kind:"mixmatch",pluIds:[],qty:2,price:5,on:true});refresh()};
  W.addPrI=(id,pid)=>{if(!pid)return;const p=byId(CFG.promos,id);
    if(!p.pluIds.includes(pid))p.pluIds.push(pid);refresh();reload()};
  W.delPrI=(id,pid)=>{const p=byId(CFG.promos,id);p.pluIds=p.pluIds.filter(x=>x!==pid);refresh();reload()};
  $("cfgBody").innerHTML=(CFG.promos||[]).map(p=>`
    <div class="sect">Mix and match</div>
    <div class="frm">
      <label>Name<input value="${esc(p.n)}" oninput="__w.setPr('${p.id}','n',this.value)"></label>
      <label>Buy any<input class="n" value="${p.qty}" oninput="__w.setPr('${p.id}','qty',this.value)"></label>
      <label>for<input class="n" value="${money(p.price)}" oninput="__w.setPr('${p.id}','price',this.value)"></label>
      <label>Active<br><input type="checkbox" ${p.on?"checked":""} onchange="__w.togPr('${p.id}',this.checked)"
        style="width:auto;margin-top:10px"></label>
    </div>
    <table class="tbl" style="margin-top:8px"><tbody>${p.pluIds.map(id=>{const x=byId(CFG.plus,id);
      return`<tr><td style="padding-left:9px">${esc(x?x.n:"(missing)")}
        ${x?`<span style="color:var(--txt-3);font-size:12px"> · ${money(x.price)}</span>`:""}</td>
      <td style="width:32px"><button class="del" onclick="__w.delPrI('${p.id}','${id}')" aria-label="Remove">×</button></td></tr>`}).join("")
      ||`<tr><td style="padding:9px;color:var(--txt-3)">No items in this deal yet.</td></tr>`}</tbody></table>
    <div style="display:flex;gap:8px;margin-top:8px">
      <select onchange="__w.addPrI('${p.id}',this.value);this.value=''"
        style="flex:1;background:rgba(0,0,0,.26);border:1px solid var(--line-2);color:var(--txt);padding:9px;border-radius:4px">
        <option value="">Add an item to the deal…</option>
        ${CFG.plus.map(x=>`<option value="${x.id}">${esc(x.n)}</option>`).join("")}</select>
      <button class="del" onclick="__w.delPr('${p.id}')" style="padding:0 10px" aria-label="Delete deal">×</button></div>`).join("")
    +`<div><button class="mini" onclick="__w.addPr()">Add a deal</button></div>
      <div class="note">The engine discounts the highest-priced qualifying items first, so the customer always
        gets the better of the two outcomes. Deals apply before any manual discount and before tax.</div>`;
}
function tPeople(){
  W.setE=(id,f,v)=>{byId(CFG.employees,id)[f]=v};
  W.delE=id=>{if(CFG.employees.length<2)return alertCard("Can't remove","At least one person needs to be able to sign in.");
    CFG.employees=CFG.employees.filter(e=>e.id!==id);refresh()};
  W.addE=()=>{CFG.employees.push({id:"E"+uid(),n:"New person",pin:String(1000+Math.floor(Math.random()*8999)),
    groupId:"G1"});refresh()};
  W.togPerm=(gid,perm)=>{const g=byId(CFG.groups,gid);
    const i=g.perms.indexOf(perm);i<0?g.perms.push(perm):g.perms.splice(i,1);refresh();drawRail()};
  $("cfgBody").innerHTML=`<div class="sect">People</div>
    <table class="tbl"><thead><tr><th style="width:40%">Name</th><th style="width:20%">Sign-in code</th>
      <th style="width:30%">Security group</th><th></th></tr></thead><tbody>
    ${CFG.employees.map(e=>`<tr>
      <td><input value="${esc(e.n)}" oninput="__w.setE('${e.id}','n',this.value)"></td>
      <td><input class="n" value="${esc(e.pin)}" maxlength="4" oninput="__w.setE('${e.id}','pin',this.value)"></td>
      <td><select onchange="__w.setE('${e.id}','groupId',this.value)">${CFG.groups.map(g=>
        `<option value="${g.id}" ${e.groupId===g.id?"selected":""}>${esc(g.n)}</option>`).join("")}</select></td>
      <td><button class="del" onclick="__w.delE('${e.id}')" aria-label="Delete">×</button></td></tr>`).join("")}
    </tbody></table><button class="mini" onclick="__w.addE()">Add a person</button>
    <div class="sect">Security groups</div>
    <table class="tbl"><thead><tr><th style="width:130px">Group</th>${PERMS.map(([k,l])=>
      `<th style="font-size:10.5px">${l.split(" ")[0]}</th>`).join("")}</tr></thead><tbody>
    ${CFG.groups.map(g=>`<tr><td style="padding-left:9px">${esc(g.n)}</td>${PERMS.map(([k])=>
      `<td style="text-align:center"><input type="checkbox" ${g.perms.includes(k)?"checked":""}
        onchange="__w.togPerm('${g.id}','${k}')" style="width:auto"></td>`).join("")}</tr>`).join("")}
    </tbody></table>
    <div class="note">Permissions attach to the group, not the person. When a cashier attempts something outside
      their group, the terminal asks a manager to key in over them and records who approved it in the exception
      log — which is the whole point of the mechanism.</div>`;
}
function tReasons(){
  W.setRC=(id,f,v)=>{byId(CFG.reasons,id)[f]=v};
  W.delRC=id=>{CFG.reasons=CFG.reasons.filter(r=>r.id!==id);refresh()};
  W.addRC=()=>{CFG.reasons.push({id:"RC"+uid(),n:"New reason",type:"void"});refresh()};
  $("cfgBody").innerHTML=`<table class="tbl"><thead><tr>
      <th style="width:56%">Reason</th><th style="width:34%">Applies to</th><th></th></tr></thead><tbody>
    ${CFG.reasons.map(r=>`<tr>
      <td><input value="${esc(r.n)}" oninput="__w.setRC('${r.id}','n',this.value)"></td>
      <td><select onchange="__w.setRC('${r.id}','type',this.value)">${
        [["void","Voiding a line"],["refund","Returns"],["payout","Pay out"],["nosale","No sale"]].map(([k,l])=>
        `<option value="${k}" ${r.type===k?"selected":""}>${l}</option>`).join("")}</select></td>
      <td><button class="del" onclick="__w.delRC('${r.id}')" aria-label="Delete">×</button></td></tr>`).join("")}
    </tbody></table><button class="mini" onclick="__w.addRC()">Add a reason code</button>
    <div class="note">Requiring a reason on every exception is the cheapest shrink control there is. It costs the
      cashier one tap and turns an untraceable void into a line in the exception log.</div>`;
}
/* An ⓘ beside each rate. Hovering explains what belongs in the bracket with real
   products, and — more useful — what people wrongly put in it. Getting candy into
   the wrong bracket is a rounding error per sale and a real number per year. */
function taxInfo(r){
  if(!r.examples?.length&&!r.notIn?.length&&!r.why)return "";
  return `<span class="info" tabindex="0" onclick="this.classList.toggle('open')">ⓘ<span class="pop">
    <b>${esc(r.n)} · ${r.rate}%</b>
    ${r.why?`<em>${esc(r.why)}</em>`:""}
    ${r.examples?.length?`<u>Rings at this rate</u><span class="ex">${
      r.examples.map(x=>`<i>${esc(x)}</i>`).join("")}</span>`:""}
    ${r.notIn?.length?`<u>Often confused, but isn't</u><span class="ex no">${
      r.notIn.map(x=>`<i>${esc(x)}</i>`).join("")}</span>`:""}
  </span></span>`;
}
function tSite(){
  W.setT=(id,f,v)=>{const r=byId(CFG.taxRates,id);r[f]=f==="rate"?(parseFloat(v)||0):v;reload()};
  W.delT=id=>{if(CFG.depts.some(d=>d.taxId===id))
      return alertCard("Rate in use","A department still points at this rate. Move it first.");
    CFG.taxRates=CFG.taxRates.filter(r=>r.id!==id);refresh();reload()};
  W.addT=()=>{CFG.taxRates.push({id:"TX"+uid(),n:"New rate",rate:0});refresh()};
  W.setRem=(id,f,v)=>{byId(CFG.reminders,id)[f]=v};
  W.delRem=id=>{CFG.reminders=CFG.reminders.filter(t=>t.id!==id);refresh()};
  W.addRem=()=>{CFG.reminders.push({id:"T"+uid(),n:"New task",at:"12:00",done:false});refresh()};
  $("cfgBody").innerHTML=`<div class="frm">
      <label>Store name<input id="sN" value="${esc(CFG.site.name)}"></label>
      <label>Receipt tagline<input id="sT" value="${esc(CFG.site.tagline)}"></label>
      <label>Address<input id="sA" value="${esc(CFG.site.addr)}"></label>
      <label>Store number<input id="sS" value="${esc(CFG.site.store)}"></label>
      <label>Register<input id="sR" value="${esc(CFG.site.register)}"></label>
    </div>
    <div class="sect">Pricing rules</div>
    <div class="frm">
      <label>Target gross margin<input class="n" id="pMar" value="${CFG.pricing.margin}"></label>
      <label>Price ending<select id="pEnd">${[["x9","End in 9 cents"],["99","Always .99"],
        ["95","Always .95"],["49-99",".49 or .99"],["none","Don't round"]].map(([k,l])=>
        `<option value="${k}" ${CFG.pricing.ending===k?"selected":""}>${l}</option>`).join("")}</select></label>
      <label>Rounding direction<select id="pDir">${[["nearest","Nearest"],["up","Always up"],["down","Always down"]].map(([k,l])=>
        `<option value="${k}" ${CFG.pricing.dir===k?"selected":""}>${l}</option>`).join("")}</select></label>
    </div>
    <div class="cbar"><span class="cdot" style="background:var(--vfd)"></span>
      A $2.00 cost prices at <b class="num" id="pEg">${money(priceFor(2))}</b>,
      a $6.40 cost at <b class="num" id="pEg2">${money(priceFor(6.4))}</b>.</div>
    <div class="note">These drive invoice intake. Change them and the next batch reprices; existing shelf
      prices are left alone.</div>

    <div class="sect">Tax rates${CFG.site.loc?` — ${esc(CFG.site.loc)}`:""}</div>
    ${!CFG.tax?.confirmed&&CFG.taxRates.some(r=>r.rate>0)?`
      <div class="verify">
        <div class="vhead">These rates aren't confirmed yet</div>
        <p>Rate aggregators disagree with each other and go stale. Check these against the state's own
          address lookup before you take money on them — an under-collected rate comes out of your margin,
          and an over-collected one is a refund you'll owe.</p>
        ${CFG.tax?.mode==="pages"?`<p>Read from ${CFG.tax.pagesRead?.length||0} published rate
          page${CFG.tax.pagesRead?.length===1?"":"s"}. Those sites cache at different times, so where they
          disagree the figures below follow the most recently dated one.</p>`
        :CFG.tax?.mode==="search"?`<p>Found by live web search.</p>`
        :CFG.tax?.mode==="memory"?`<p class="vconf">No live source could be reached, so these came from the
          model's own knowledge. Treat them as a rough starting point only.</p>`:""}
        ${CFG.tax?.conflict?`<p class="vconf">${esc(CFG.tax.conflict)}</p>`:""}
        ${CFG.tax?.sumNote?`<p class="vconf">${esc(CFG.tax.sumNote)}</p>`:""}
        ${CFG.tax?.recent?`<p class="vconf">Recent change: ${esc(CFG.tax.recent)}</p>`:""}
        ${CFG.tax?.sources?.length?`<div class="vsrc">What each source said:
          ${CFG.tax.sources.map(s=>`<span>${esc(s.n||s.url)} <b>${s.rate}%</b></span>`).join("")}</div>`:""}
        <div class="vact">
          ${CFG.tax?.verifyUrl?`<a class="mini" href="${esc(CFG.tax.verifyUrl)}" target="_blank" rel="noopener">
            Open the official rate finder</a>`:""}
          <button class="mini ok" style="color:#0D1F18" onclick="__w.confirmTax()">
            I've checked these — mark them confirmed</button>
        </div>
      </div>`:""}
    ${CFG.tax?.confirmed?`<div class="verify ok2"><div class="vhead">Confirmed${
      CFG.tax.confirmedAt?` on ${esc(CFG.tax.confirmedAt)}`:""}</div>
      <p>Edit any rate below and it goes back to unconfirmed.</p></div>`:""}
    ${CFG.taxRates[0]?.parts?.length?`<div class="cbar" style="display:block">
      <b>${CFG.taxRates[0].rate}%</b> general merchandise = ${CFG.taxRates[0].parts.map(p=>
        `${esc(p.n)} ${p.rate}%`).join(" + ")}.</div>`:""}
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:9px">
      <input id="taxLoc" value="${esc(CFG.site.loc||"")}" placeholder="Street address, or City, State ZIP"
        style="flex:1;background:rgba(0,0,0,.26);border:1px solid var(--line-2);color:var(--txt);padding:10px;border-radius:4px">
      <button class="mini" style="margin:0;flex:none" id="taxGo">Look it up again</button></div>
    <div id="taxStat"></div>
    <table class="tbl"><thead><tr><th style="width:22%">Rate</th><th style="width:11%">Percent</th>
      <th style="width:48%">What falls into it</th><th>Depts</th><th></th></tr></thead><tbody>
    ${CFG.taxRates.map(r=>`<tr>
      <td><input value="${esc(r.n)}" oninput="__w.setT('${r.id}','n',this.value)"></td>
      <td><input class="n" value="${r.rate}" oninput="__w.setT('${r.id}','rate',this.value)"></td>
      <td style="padding-left:8px;color:var(--txt-2);font-size:12px;line-height:1.5">
        <span class="whatcell">${esc(r.what||"—")}${taxInfo(r)}</span>
        ${r.carveOut?`<div class="carve">taxed at the full rate, despite looking like groceries</div>`:""}</td>
      <td style="padding-left:9px;color:var(--txt-2)">${CFG.depts.filter(d=>d.taxId===r.id).length}</td>
      <td><button class="del" onclick="__w.delT('${r.id}')" aria-label="Delete">×</button></td></tr>`).join("")}
    </tbody></table><button class="mini" onclick="__w.addT()">Add a tax rate</button>
    <div class="note">Departments point at these rates, so moving a department between categories is one
      change under Departments. Every product in it follows.</div>

    <div class="sect">Cash handling</div>
    <label style="font-size:13.5px;display:flex;align-items:center;gap:9px">
      <input type="checkbox" id="sNick" ${CFG.rounding.nickel?"checked":""} style="width:auto">
      Round cash totals to the nearest five cents</label>
    <div class="note">With the penny discontinued, cash totals can round to the nickel while card and EBT totals
      stay exact. The adjustment prints as its own line on the receipt.</div>
    <div class="sect">Scheduled reminders</div>
    <table class="tbl"><thead><tr><th style="width:70%">Task</th><th style="width:22%">Due at</th><th></th></tr></thead><tbody>
    ${CFG.reminders.map(t=>`<tr>
      <td><input value="${esc(t.n)}" oninput="__w.setRem('${t.id}','n',this.value)"></td>
      <td><input class="n" value="${esc(t.at)}" placeholder="14:00" oninput="__w.setRem('${t.id}','at',this.value)"></td>
      <td><button class="del" onclick="__w.delRem('${t.id}')" aria-label="Delete">×</button></td></tr>`).join("")}
    </tbody></table><button class="mini" onclick="__w.addRem()">Add a reminder</button>
    <div class="note">Reminders badge the Office tab once they're due and reset at shift close.</div>`;
  const pv=()=>{$("pEg").textContent=money(priceFor(2));$("pEg2").textContent=money(priceFor(6.4))};
  $("pMar").oninput=e=>{CFG.pricing.margin=Math.min(94,Math.max(0,parseFloat(e.target.value)||0));pv()};
  $("pEnd").onchange=e=>{CFG.pricing.ending=e.target.value;pv()};
  $("pDir").onchange=e=>{CFG.pricing.dir=e.target.value;pv()};
  $("taxGo").onclick=async()=>{
    const place=$("taxLoc").value.trim();if(place.length<3)return;
    const st=$("taxStat");
    st.innerHTML=`<div class="note" style="border-color:var(--vfd-dim);margin-top:0">Searching for the current rate in ${esc(place)}…</div>`;
    $("taxGo").disabled=true;
    try{
      const names=CFG.depts.filter(d=>!d.fuel).map(d=>d.n);
      const t=await lookupTax(place,A.type||"retail store",names);
      CFG.site.loc=place;
      /* Rebuild the rate table, but keep any rate a department still points at
         so nothing is orphaned mid-edit. */
      const keyToId={},fresh=[];
      t.categories.forEach((cat,i)=>{
        const id="TX"+(i+1);keyToId[cat.key]=id;
        fresh.push({id,n:cat.n||cat.key,rate:+(+cat.rate||0).toFixed(3),what:cat.what||null,
          parts:i===0?(t.breakdown||null):null,src:i===0?(t.note||null):null});
      });
      if(!fresh.some(r=>r.rate===0)){fresh.push({id:"TX0",n:"Non-taxable",rate:0});keyToId.exempt="TX0"}
      else keyToId.exempt=keyToId.exempt||fresh.find(r=>r.rate===0).id;
      const generalId=keyToId.general||fresh[0].id;
      CFG.taxRates=fresh;
      CFG.tax={place:t.place,state:t.state,sources:t.sources||[],verifyUrl:t.verifyUrl||"",
        conflict:t.conflict||null,sumNote:t.sumNote||null,recent:t.recent||null,
        mode:t.mode,pagesRead:t.pagesRead||[],confirmed:false};
      CFG.depts.forEach(d=>{
        if(d.fuel){d.taxId=keyToId.exempt;return}
        d.taxId=keyToId[(t.deptTax||{})[d.n]]||generalId;
      });
      CFG.plus.forEach(p=>{if(!byId(CFG.taxRates,byId(CFG.depts,p.deptId)?.taxId)){}});
      reload();drawConfig();
      toast(`Set up <b>${t.categories.length}</b> tax categor${t.categories.length===1?"y":"ies"} for
        <b>${esc(t.place||place)}</b>. ${t.conflict?"Sources disagreed — check them.":"Confirm them before opening."}`);
    }catch(e){
      const m=String(e&&e.message||e);
      const hint=/web.?search|tool|not.*enabled|unsupported/i.test(m)
        ? `Web search looks unavailable on this API key — enable it in the Anthropic console, or type the
           rates in by hand below.`
        : /rate limit|429/i.test(m) ? `Too many requests just now. Wait a minute and try again.`
        : /401|403|credit|balance/i.test(m) ? `The API key was rejected. Check ANTHROPIC_API_KEY on the server.`
        : `Try a full street address, or "City, State ZIP". You can also type the rates in by hand below.`;
      st.innerHTML=`<div class="note" style="border-color:var(--void);margin-top:0">
        <b>The lookup failed.</b> ${esc(hint)}
        <div class="asprint" style="margin-top:7px;white-space:normal">${esc(m)}</div></div>`;
      $("taxGo").disabled=false;
    }
  };
  const w=(id,f)=>$(id).oninput=e=>f(e.target.value);
  w("sN",v=>{CFG.site.name=v;$("hdrName").textContent=v});
  w("sT",v=>CFG.site.tagline=v);w("sA",v=>CFG.site.addr=v);
  w("sS",v=>{CFG.site.store=v;$("hdrMeta").textContent=`Reg ${CFG.site.register} · Store ${v}`});
  w("sR",v=>{CFG.site.register=v;$("hdrMeta").textContent=`Reg ${v} · Store ${CFG.site.store}`});
  $("sNick").onchange=e=>CFG.rounding.nickel=e.target.checked;
}
/* Account and data. Everything here answers one question: is this mine, and can
   I get it out? A merchant's sales journal is a tax record — they should be able
   to take it and go at any time, and nobody else should ever see it. */
function tAccount(){
  W.chgPass=()=>{
    const el=veil(`<div class="card"><h3>Change password</h3>
      <p>Changing it signs you out on every other device.</p>
      <input id="p0" type="password" placeholder="Current password" style="margin-top:14px">
      <input id="p1" type="password" placeholder="New password, 8 characters or more" style="margin-top:8px">
      <div id="pmsg" style="margin-top:10px;font-size:13px;color:var(--void);min-height:18px"></div>
      <div class="row"><button class="no" id="pn">Cancel</button><button class="ok" id="py">Change it</button></div></div>`);
    el.querySelector("#pn").onclick=()=>el.remove();
    el.querySelector("#py").onclick=async()=>{
      try{
        await api("/api/account/password",{method:"POST",body:{
          current:el.querySelector("#p0").value,next:el.querySelector("#p1").value}});
        el.remove();toast("Password changed. Other devices have been signed out.");
      }catch(e){el.querySelector("#pmsg").textContent=e.message}
    };
  };
  W.revoke=async()=>{
    try{const d=await api("/api/account/sessions/revoke",{method:"POST",body:{}});
      toast(`Signed out of <b>${d.revoked}</b> other session${d.revoked===1?"":"s"}.`);refresh()}
    catch(e){toast(e.message,true)}
  };
  W.exportAll=()=>{window.location.href="/api/account/export"};
  W.wipe=()=>{
    const el=veil(`<div class="card"><h3>Delete this account</h3>
      <p>This removes every store, the whole pricebook, every shift and every sale on file. It cannot
        be undone and there is no copy kept. Export your data first if you might want it.</p>
      <input id="w0" type="password" placeholder="Your password" style="margin-top:14px">
      <input id="w1" placeholder="Type DELETE to confirm" style="margin-top:8px">
      <div id="wmsg" style="margin-top:10px;font-size:13px;color:var(--void);min-height:18px"></div>
      <div class="row"><button class="no" id="wn">Cancel</button>
        <button class="danger" id="wy">Delete everything</button></div></div>`);
    el.querySelector("#wn").onclick=()=>el.remove();
    el.querySelector("#wy").onclick=async()=>{
      try{
        await api("/api/account/delete",{method:"POST",body:{
          password:el.querySelector("#w0").value,confirm:el.querySelector("#w1").value}});
        location.href="/login.html";
      }catch(e){el.querySelector("#wmsg").textContent=e.message}
    };
  };
  $("cfgBody").innerHTML=`<div id="acctBody"><p style="color:var(--txt-3);font-size:13px">Loading…</p></div>`;
  /* The fleet console is only mentioned to accounts that have it. Everyone else
     never learns the route exists, and the server answers 404 regardless. */
  api("/api/admin/whoami").then(r=>{
    const el=$("opLink");
    if(el&&r.operator)el.innerHTML=`<a class="mini" href="/admin.html"
      style="text-decoration:none;display:inline-block">Fleet console</a>`;
  }).catch(()=>{});
  Promise.all([api("/api/me"),api("/api/account/sessions"),api("/api/account/activity")])
    .then(([me,ses,act])=>{
      $("acctBody").innerHTML=`
        <div class="sect">Signed in as</div>
        <div class="cbar"><span class="cdot" style="background:var(--vfd)"></span>
          <b>${esc(me.account.email)}</b> · ${me.stores.length} store${me.stores.length===1?"":"s"}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:11px">
          <button class="mini" onclick="__w.chgPass()">Change password</button>
          <button class="mini" onclick="__w.exportAll()">Download all my data</button>
          <span id="opLink"></span>
        </div>

        <div class="sect">Who can see this data</div>
        <div class="note" style="margin-top:0">Your pricebook, shifts and sales are readable only by this
          account. Every request that touches them is checked against your account id before the query runs,
          so another tenant cannot reach them even by guessing an address. Deleting the account removes all
          of it, and the export above is the same data in full — you are never locked in.</div>

        <div class="sect">Active sessions — ${ses.sessions.length}</div>
        <table class="tbl"><thead><tr><th>Session</th><th>Signed in</th><th>Expires</th><th></th></tr></thead><tbody>
        ${ses.sessions.map(s=>`<tr>
          <td style="padding-left:9px" class="num">${esc(s.id)}${s.current?` <span class="chip new">this device</span>`:""}</td>
          <td style="padding-left:9px;color:var(--txt-2);font-size:12.5px">${esc(s.created_at)}</td>
          <td style="padding-left:9px;color:var(--txt-2);font-size:12.5px">${esc(s.expires_at.slice(0,10))}</td>
          <td></td></tr>`).join("")}
        </tbody></table>
        ${ses.sessions.length>1?`<button class="mini" onclick="__w.revoke()">Sign out everywhere else</button>`:""}

        <div class="sect">Recent account activity</div>
        <table class="tbl"><thead><tr><th style="width:22%">When</th><th style="width:24%">What</th>
          <th style="width:30%">Detail</th><th>From</th></tr></thead><tbody>
        ${act.activity.slice(0,12).map(a=>`<tr>
          <td style="padding-left:9px;color:var(--txt-2);font-size:12.5px">${esc(a.at)}</td>
          <td style="padding-left:9px">${esc(a.action)}</td>
          <td style="padding-left:9px;color:var(--txt-2);font-size:12.5px">${esc(a.detail||"—")}</td>
          <td style="padding-left:9px;color:var(--txt-3);font-size:12px" class="num">${esc(a.ip||"—")}</td>
        </tr>`).join("")||`<tr><td colspan="4" style="padding:11px;color:var(--txt-3)">Nothing yet.</td></tr>`}
        </tbody></table>
        <div class="note">Sign-ins, password changes, exports and deletions are logged here. If you see a
          sign-in you don't recognise, change your password — that signs out every other device.</div>

        <div class="sect" style="color:var(--void)">Danger zone</div>
        <button class="mini" style="border-color:var(--void);color:var(--void)" onclick="__w.wipe()">
          Delete this account and all its data</button>`;
    }).catch(e=>{$("acctBody").innerHTML=`<p style="color:var(--void)">${esc(e.message)}</p>`});
}

/* ===========================================================================
   The change agent.

   Two design rules make this both capable and safe.

   1. The model describes intent with a selector; the code decides what matches.
      "Every drink over two dollars" comes back as a where-clause, and this file
      resolves it against the real pricebook. The model never gets to hand us a
      list of items to delete — it can only describe a rule, which we evaluate.

   2. Nothing is applied without a preview and a snapshot. Every proposal shows
      the exact count and before/after samples, and every applied change can be
      undone in one tap.
   =========================================================================== */
let CHAT=[],PROPOSAL=null,CHATBUSY=false,UNDO=[],OPEN_OPS=new Set();

/* ------------------------------- selectors ------------------------------- */
function resolveWhere(w){
  if(!w||typeof w!=="object")return [];
  let list=CFG.plus.slice();
  const dept=w.dept?CFG.depts.find(d=>!d.fuel&&d.n.toLowerCase()===String(w.dept).toLowerCase()):null;
  if(w.dept&&!dept)return [];
  if(dept)list=list.filter(p=>p.deptId===dept.id);
  if(w.group)list=list.filter(p=>(p.grp||autoGroup(p.n)).toLowerCase()===String(w.group).toLowerCase());
  if(w.nameContains){const q=String(w.nameContains).toLowerCase();
    list=list.filter(p=>p.n.toLowerCase().includes(q))}
  if(w.nameMatches){try{const re=new RegExp(w.nameMatches,"i");
    list=list.filter(p=>re.test(p.n))}catch(e){return []}}
  if(Array.isArray(w.upcs)&&w.upcs.length)list=list.filter(p=>w.upcs.includes(p.upc));
  if(w.noBarcode)list=list.filter(p=>!p.upc);
  if(w.noCost)list=list.filter(p=>!(p.cost>0));
  if(typeof w.priceOver==="number")list=list.filter(p=>p.price>w.priceOver);
  if(typeof w.priceUnder==="number")list=list.filter(p=>p.price<w.priceUnder);
  if(w.taxRate){const t=CFG.taxRates.find(r=>r.n.toLowerCase()===String(w.taxRate).toLowerCase());
    if(t)list=list.filter(p=>byId(CFG.depts,p.deptId)?.taxId===t.id)}
  return list;
}
function whereText(w,bare){
  if(!w)return "nothing";
  const bits=[];
  if(w.dept)bits.push(`in ${w.dept}`);
  if(w.group)bits.push(`in the ${w.group} group`);
  if(w.nameContains)bits.push(`named like "${w.nameContains}"`);
  if(w.nameMatches)bits.push(`matching /${w.nameMatches}/`);
  if(w.noBarcode)bits.push("with no barcode");
  if(w.noCost)bits.push("with no cost");
  if(typeof w.priceOver==="number")bits.push(`over ${money(w.priceOver)}`);
  if(typeof w.priceUnder==="number")bits.push(`under ${money(w.priceUnder)}`);
  if(Array.isArray(w.upcs)&&w.upcs.length)bits.push(`${w.upcs.length} named item${w.upcs.length===1?"":"s"}`);
  if(!bits.length)return bare?"":"across the whole pricebook";
  return bits.join(", ");
}
/* "Rename 15 products in Beverages" reads fine; "Rename 15 products every
   product" does not. Build the phrase rather than concatenating fragments. */
function countPhrase(n,w){
  const noun=`${n} product${n===1?"":"s"}`;
  const where=whereText(w);
  return where?`${noun} ${where}`:noun;
}

/* -------------------------- what an op would do --------------------------- */
/* Computed against the live pricebook, so the count in the proposal is the real
   count, not the model's guess at one. */
function previewOp(o){
  const s={op:o,samples:[],count:0,danger:false,label:"",note:null};
  /* Every affected product, with its id and name, so the proposal can be
     approved product by product and each row says which product it is. */
  /* Rows where the value is already what we'd set are dropped. "Mr Fog Max Pro
     → Mr Fog Max Pro" is not a change, and counting it inflates the proposal
     with work that isn't there. */
  const sample=(list,fn)=>list.slice(0,300)
    .map(p=>({id:p.id,name:p.n,before:String(fn.before(p)),after:String(fn.after(p))}))
    .filter(r=>r.before!==r.after);
  try{
    switch(o.op){
      case "rename":{
        const list=resolveWhere(o.where);
        s.label=`Rename ${countPhrase(list.length,o.where)}`;
        s.samples=sample(list,{before:p=>p.n,after:p=>renameOne(p.n,o)}).map(r=>({...r,name:null}));
        s.count=s.samples.length;
        s.label=`Rename ${countPhrase(s.count,o.where)}`;
        if(!s.count&&list.length)s.note="Those names already read that way.";
        break;}
      case "setPrice":{
        const list=resolveWhere(o.where);
        const how=o.mode==="add"?`${o.value>=0?"add":"take off"} ${money(Math.abs(o.value))}`
          :o.mode==="multiply"?`change by ${((o.value-1)*100).toFixed(0)}%`
          :o.mode==="margin"?`reprice at ${marginValue(o.value)}% margin`
          :`set to ${money(o.value)}`;
        s.samples=sample(list,{before:p=>money(p.price),after:p=>money(newPrice(p,o))});
        s.count=s.samples.length;
        s.label=`Reprice ${countPhrase(s.count,o.where)} — ${how}`;
        if(o.mode==="margin")s.note=list.some(p=>!(p.cost>0))
          ?"Some of these have no cost recorded, so they'll be left alone.":null;
        break;}
      case "move":{
        const list=resolveWhere(o.where);
        const d=CFG.depts.find(x=>!x.fuel&&x.n.toLowerCase()===String(o.dept).toLowerCase());
        s.samples=sample(list,{before:p=>byId(CFG.depts,p.deptId)?.n||"?",after:()=>o.dept});
        s.count=s.samples.length;
        s.label=`Move ${countPhrase(s.count,o.where)} into ${o.dept}`;
        s.note=d?(s.count?null:`Everything there is already in ${o.dept}.`)
               :`${o.dept} doesn't exist yet — it'll be created.`;
        break;}
      case "setField":{
        const list=resolveWhere(o.where);
        const nice={ebt:"EBT eligible",weighed:"sold by weight",grp:"shelf group",
          restrictId:"restriction",cost:"cost"}[o.field]||o.field;
        /* Show restriction names, not internal ids — "R1" means nothing to anyone. */
        const show=v=>o.field==="restrictId"?(byId(CFG.restricts,v)?.n||"none"):String(v??"—");
        const target=o.field==="restrictId"
          ? (CFG.restricts.find(r=>r.n.toLowerCase()===String(o.value).toLowerCase())
             ||CFG.restricts.find(r=>String(r.minAge)===String(o.value)))
          : null;
        s.samples=sample(list,{before:p=>show(p[o.field]),
          after:()=>o.field==="restrictId"?(target?target.n:String(o.value)):String(o.value)});
        s.count=s.samples.length;
        s.label=`Set ${nice} on ${countPhrase(s.count,o.where)}`;
        if(o.field==="restrictId"&&!target)
          s.note=`No restriction called "${o.value}" exists — add it under Restrictions first.`;
        else if(!s.count)s.note="Already set on everything that matched.";
        break;}
      case "delete":{
        const list=resolveWhere(o.where);
        s.count=list.length;s.danger=true;
        s.label=`Delete ${countPhrase(list.length,o.where)}`;
        s.samples=sample(list,{before:p=>p.n,after:()=>"removed"});
        break;}
      case "addItems":{
        const n=(o.items||[]).length;s.count=n;
        s.label=`Add ${n} new product${n===1?"":"s"} to ${o.dept}`;
        s.samples=(o.items||[]).slice(0,200).map(i=>({name:i.n,before:"new",after:money(+i.p||0)}));
        break;}
      case "newDept":
        s.count=1;s.label=`Create the department ${o.n}${o.tax?` on the ${o.tax} rate`:""}`;break;
      case "setDeptTax":{
        const d=CFG.depts.find(x=>x.n.toLowerCase()===String(o.dept).toLowerCase());
        s.count=d?CFG.plus.filter(p=>p.deptId===d.id).length:0;
        s.label=`Put ${o.dept} on the ${o.tax} tax rate`;
        s.note=d?`Affects ${s.count} product${s.count===1?"":"s"}.`:`${o.dept} not found.`;break;}
      case "delDept":{
        const d=CFG.depts.find(x=>!x.fuel&&x.n.toLowerCase()===String(o.dept).toLowerCase());
        s.count=d?CFG.plus.filter(p=>p.deptId===d.id).length:0;
        s.danger=s.count>0;
        s.label=s.count
          ? `Delete the ${o.dept} department and its ${s.count} product${s.count===1?"":"s"}`
          : `Delete the ${o.dept} department`;
        if(!s.count)s.note=d
          ? "It'll be empty by the time this runs, so no products are lost."
          : `${o.dept} doesn't exist.`;
        break;}
      case "addPromo":{
        const ids=(o.upcs||[]).map(u=>CFG.plus.find(p=>p.upc===u)).filter(Boolean);
        s.count=ids.length;
        s.label=`Add the deal "${o.n}" — ${o.qty||2} for ${money(+o.price||0)}`;
        s.samples=ids.slice(0,200).map(p=>({id:p.id,name:p.n,before:"—",after:"in the deal"}));break;}
      case "setGroup":{
        const list=resolveWhere(o.where);
        s.samples=sample(list,{before:p=>p.grp||autoGroup(p.n),after:()=>o.group});
        s.count=s.samples.length;
        s.label=`Group ${countPhrase(s.count,o.where)} under "${o.group}"`;
        if(!s.count)s.note=`Everything that matched is already grouped under "${o.group}".`;
        break;}
      default: s.label=`Unrecognised operation (${o.op})`;
    }
  }catch(e){s.label=`Couldn't work out what this would do`;s.count=0}
  return s;
}
function renameOne(name,o){
  let out=String(name);
  if(o.find){
    try{ out=out.replace(new RegExp(o.find,"gi"), o.replace==null?"":o.replace); }
    catch(e){ out=out.split(o.find).join(o.replace||""); }
  }
  /* "strip" is one regex, or an array of them. It is NOT split on "|" — that
     character is alternation, and splitting on it shreds any pattern using it. */
  if(o.strip){
    const pats=Array.isArray(o.strip)?o.strip:[o.strip];
    pats.forEach(t=>{
      try{ out=out.replace(new RegExp(t,"gi"),""); }
      catch(e){ out=out.split(String(t)).join(""); }
    });
  }
  return out.replace(/\s{2,}/g," ").replace(/\s*[,\-–(]\s*$/,"").trim();
}
/* A model asked for "42% margin" will sometimes answer 0.42. Taken literally
   that prices a $2.89 drink at $1.49, so normalise before anything uses it. */
function marginValue(v){
  const n=+v||0;
  return (n>0&&n<1)?n*100:n;
}
function newPrice(p,o){
  const v=o.mode==="margin"?marginValue(o.value):(+o.value||0);
  let n=o.mode==="add"?p.price+v
    :o.mode==="multiply"?p.price*v
    :o.mode==="margin"?(p.cost>0?fromMargin(p.cost,v):p.price)
    :v;
  if(n<0)n=0;
  return o.round&&o.round!=="none"?charm(n,o.round,"nearest"):Math.round(n*100)/100;
}

/* ------------------------------- applying -------------------------------- */
/* Operations run in order and each one changes what the next one sees. A delete
   that follows a move finds an empty department, so previewing every op against
   the CURRENT pricebook reports products that will already be gone. Preview
   against a simulated copy instead, applying as we go — the same way apply does. */
function previewAll(ops){
  const real=CFG;
  const sim=JSON.parse(JSON.stringify(CFG));
  const out=[];
  try{
    CFG=sim;
    ops.forEach(o=>{
      const p=previewOp(o);
      out.push(p);
      if(!o.on)return;                       // unticked ops don't affect what follows
      const perItem=p.samples.length&&p.samples[0].id;
      applyOp(o,perItem&&o.sel?o.sel:null);
    });
  } finally { CFG=real; }
  return out;
}

function snapshot(label){
  UNDO.push({label,at:new Date(),cfg:JSON.parse(JSON.stringify(CFG))});
  if(UNDO.length>10)UNDO.shift();
}
function applyOp(o,only){
  let n=0;
  /* "only" is the set of product ids the owner ticked. Absent, the op applies to
     everything its rule matched. */
  const pick=list=>only?list.filter(p=>only.has(p.id)):list;
  switch(o.op){
    case "rename": pick(resolveWhere(o.where)).forEach(p=>{
      const nn=renameOne(p.n,o); if(nn&&nn!==p.n){p.n=nn;n++} }); break;
    case "setPrice": pick(resolveWhere(o.where)).forEach(p=>{
      const np=newPrice(p,o); if(Math.abs(np-p.price)>0.001){p.price=np;n++} }); break;
    case "move":{
      let d=CFG.depts.find(x=>!x.fuel&&x.n.toLowerCase()===String(o.dept).toLowerCase());
      if(!d){d={id:"D"+uid(),n:o.dept,taxId:CFG.taxRates[0].id,food:false,
        color:PALETTE[CFG.depts.length%PALETTE.length]};CFG.depts.push(d);
        CFG.menus.push({id:"M"+d.id,n:d.n,color:d.color,keys:[]})}
      pick(resolveWhere(o.where)).forEach(p=>{
        if(p.deptId===d.id)return;
        CFG.menus.forEach(m=>m.keys=m.keys.filter(k=>k.pluId!==p.id));
        p.deptId=d.id;
        const m=CFG.menus.find(x=>x.id==="M"+d.id); if(m)m.keys.push({pluId:p.id});
        n++; });
      break;}
    case "setField": pick(resolveWhere(o.where)).forEach(p=>{
      let v=o.value;
      if(o.field==="ebt"||o.field==="weighed")v=!!v;
      if(o.field==="cost")v=parseFloat(v)||0;
      if(o.field==="restrictId"){const r=CFG.restricts.find(x=>x.n.toLowerCase()===String(v).toLowerCase());
        v=r?r.id:null}
      p[o.field]=v;n++; }); break;
    case "delete":{
      const list=pick(resolveWhere(o.where)),ids=list.map(p=>p.id);
      CFG.plus=CFG.plus.filter(p=>!ids.includes(p.id));
      CFG.menus.forEach(m=>m.keys=m.keys.filter(k=>!ids.includes(k.pluId)));
      n=list.length;break;}
    case "setGroup": pick(resolveWhere(o.where)).forEach(p=>{p.grp=o.group;n++}); break;
    case "addItems":{
      let d=CFG.depts.find(x=>!x.fuel&&x.n.toLowerCase()===String(o.dept).toLowerCase());
      if(!d){d={id:"D"+uid(),n:o.dept,taxId:CFG.taxRates[0].id,food:!!o.food,
        color:PALETTE[CFG.depts.length%PALETTE.length]};CFG.depts.push(d);
        CFG.menus.push({id:"M"+d.id,n:d.n,color:d.color,keys:[]})}
      const menu=CFG.menus.find(x=>x.id==="M"+d.id);
      (o.items||[]).slice(0,20).forEach(it=>{
        let rid=null;
        if(it.age&&CFG.caps.includes("age")){
          let r=CFG.restricts.find(x=>x.minAge===it.age&&!x.start);
          if(!r){r={id:"R"+uid(),n:it.age+"+ age check",minAge:it.age,idScan:true,start:"",end:""};
            CFG.restricts.push(r)}
          rid=r.id}
        const p={id:"P"+uid(),upc:it.upc||"",n:it.n,price:+it.p||0,deptId:d.id,
          weighed:!!(it.wt&&CFG.caps.includes("weight")),ebt:!!(it.ebt&&CFG.caps.includes("ebt")),
          deposit:(CFG.caps.includes("deposit")&&it.dep)?+it.dep:null,restrictId:rid,modIds:[],cost:null};
        CFG.plus.push(p); if(menu)menu.keys.push({pluId:p.id}); n++; });
      break;}
    case "newDept":{
      if(!CFG.depts.some(d=>d.n.toLowerCase()===String(o.n).toLowerCase())){
        const t=CFG.taxRates.find(r=>r.n.toLowerCase()===String(o.tax||"").toLowerCase());
        const d={id:"D"+uid(),n:o.n,taxId:t?t.id:CFG.taxRates[0].id,food:!!o.food,
          color:PALETTE[CFG.depts.length%PALETTE.length]};
        CFG.depts.push(d);CFG.menus.push({id:"M"+d.id,n:d.n,color:d.color,keys:[]});n=1}
      break;}
    case "setDeptTax":{
      const d=CFG.depts.find(x=>x.n.toLowerCase()===String(o.dept).toLowerCase());
      const t=CFG.taxRates.find(r=>r.n.toLowerCase()===String(o.tax).toLowerCase());
      if(d&&t){d.taxId=t.id;n=1}break;}
    case "delDept":{
      const d=CFG.depts.find(x=>!x.fuel&&x.n.toLowerCase()===String(o.dept).toLowerCase());
      if(d){const ids=CFG.plus.filter(p=>p.deptId===d.id).map(p=>p.id);
        CFG.plus=CFG.plus.filter(p=>p.deptId!==d.id);
        CFG.depts=CFG.depts.filter(x=>x.id!==d.id);
        CFG.menus=CFG.menus.filter(m=>m.id!=="M"+d.id);
        CFG.menus.forEach(m=>m.keys=m.keys.filter(k=>!ids.includes(k.pluId)));n=1}
      break;}
    case "addPromo":{
      const ids=(o.upcs||[]).map(u=>CFG.plus.find(p=>p.upc===u)?.id).filter(Boolean);
      if(ids.length){CFG.promos.push({id:"PR"+uid(),n:o.n||"Deal",kind:"mixmatch",
        pluIds:ids,qty:+o.qty||2,price:+o.price||0,on:true});n=1}
      break;}
  }
  return n;
}

/* --------------------------------- the UI --------------------------------- */
function tAI(){
  const seeds=suggestions();
  $("cfgBody").innerHTML=`
    <p class="lede" style="margin:0 0 4px">Describe the change. It writes a rule, this screen works out
      exactly which products the rule hits, and nothing is applied until you approve it. Every change can
      be undone.</p>
    ${UNDO.length?`<div class="undobar">
      <span>Last change: <b>${esc(UNDO[UNDO.length-1].label)}</b>
        · ${UNDO[UNDO.length-1].at.toLocaleTimeString()}</span>
      <button onclick="__w.undo()">Undo it</button></div>`:""}
    <div class="chat" id="chatLog">${CHAT.length?CHAT.map(m=>chatBubble(m)).join(""):`
      <div class="chatempty"><p>Try something like:</p>
        <div class="opts">${seeds.map(s=>`<button data-x="${esc(s)}">${esc(s)}</button>`).join("")}</div>
      </div>`}</div>
    ${PROPOSAL?proposalCard():""}
    <div class="chatbar">
      <textarea id="cq" rows="1" ${CHATBUSY?"disabled":""}
        placeholder="${PROPOSAL?"Ask for a change to this proposal…":"What would you like changed? Shift+Enter for a new line."}"></textarea>
      <button class="ok" id="cgo" ${CHATBUSY?"disabled":""}>${CHATBUSY?"Working…":"Send"}</button>
    </div>
    ${CHAT.length?`<button class="mini" onclick="__w.chatClear()">Start over</button>`:""}`;
  $("cfgBody").querySelectorAll("[data-x]").forEach(b=>b.onclick=()=>{$("cq").value=b.dataset.x;send()});
  const log=$("chatLog");if(log)log.scrollTop=log.scrollHeight;
  $("cgo").onclick=send;
  const box=$("cq");
  /* Grow with the text. A long instruction that scrolls out of a one-line box
     can't be proofread, and these instructions are worth proofreading. */
  const grow=()=>{box.style.height="auto";box.style.height=Math.min(box.scrollHeight,220)+"px"};
  box.oninput=grow;
  box.onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send()}};
  if(!CHATBUSY){box.focus();grow()}

  W.chatClear=()=>{CHAT=[];PROPOSAL=null;drawConfig()};
  W.togOp=i=>{PROPOSAL.ops[i].on=!PROPOSAL.ops[i].on;drawConfig()};
  W.toggleOp=i=>{OPEN_OPS.has(i)?OPEN_OPS.delete(i):OPEN_OPS.add(i);drawConfig()};
  W.togItem=(i,id)=>{const s=PROPOSAL.ops[i].sel;s.has(id)?s.delete(id):s.add(id);drawConfig()};
  W.selAll=(i,on)=>{const o=PROPOSAL.ops[i];
    const p=(PROPOSAL.pv||[])[i]||previewOp(o);
    o.sel=on?new Set(p.samples.map(s=>s.id).filter(Boolean)):new Set();
    drawConfig()};
  W.applyOps=()=>{
    const on=PROPOSAL.ops.filter(o=>o.on&&(!o.sel||o.sel.size||!previewOp(o).samples[0]?.id));
    const label=on.length===1?previewOp(on[0]).label:`${on.length} changes from the assistant`;
    snapshot(label);
    let total=0,log=[];
    const pv=previewAll(PROPOSAL.ops);
    PROPOSAL.ops.forEach((o,i)=>{
      if(!o.on)return;
      const p=pv[i];
      const perItem=p.samples.length&&p.samples[0].id;
      const n=applyOp(o,perItem?o.sel:null);
      if(n){total+=n;log.push(p.label)}
    });
    PROPOSAL=null;OPEN_OPS=new Set();
    CHAT.push({role:"note",text:total?`Applied — ${total} product${total===1?"":"s"} affected.`
      :"Nothing matched, so nothing changed."});
    if(!total)UNDO.pop();
    MENU=0;reload();drawConfig();
    if(total)toast(`Changed <b>${total}</b> product${total===1?"":"s"}. `
      +`<button class="act" onclick="__w.undo()">Undo</button>`);
  };
  W.undo=()=>{
    const u=UNDO.pop();if(!u)return;
    Object.keys(CFG).forEach(k=>delete CFG[k]);
    Object.assign(CFG,u.cfg);
    MENU=0;reload();drawConfig();
    toast(`Undone: ${esc(u.label)}`);
  };
  W.dropOps=()=>{PROPOSAL=null;CHAT.push({role:"note",text:"Discarded — nothing changed."});drawConfig()};

  async function send(){
    const q=$("cq").value.trim();if(!q||CHATBUSY)return;
    CHAT.push({role:"you",text:q});CHATBUSY=true;PROPOSAL=null;drawConfig();
    /* The model gets shape and vocabulary, not four thousand product names. It
       writes rules; this screen resolves them. */
    const shape=CFG.depts.filter(d=>!d.fuel).map(d=>{
      const items=CFG.plus.filter(p=>p.deptId===d.id);
      const groups=[...new Set(items.map(p=>p.grp||autoGroup(p.n)))].slice(0,12);
      return `${d.n} — ${items.length} items, tax "${byId(CFG.taxRates,d.taxId)?.n}"\n`
        +`   groups: ${groups.join(", ")||"none"}\n`
        +`   examples: ${items.slice(0,5).map(p=>`${p.n} ${money(p.price)}`).join(" | ")}`;
    }).join("\n");
    try{
      const res=await callAI(null,{max_tokens:2200,kind:"agent",messages:[
        ...CHAT.filter(m=>m.role==="you"||m.role==="ai").map(m=>({
          role:m.role==="you"?"user":"assistant",
          content:m.role==="you"?m.text:JSON.stringify({reply:m.text,ops:m.ops||[]})})),
        {role:"user",content:`Pricebook at ${A.name||CFG.site.name} (${A.type||"retail"}).
Tax rates available: ${CFG.taxRates.map(r=>`"${r.n}" ${r.rate}%`).join(", ")}
Pricing rule: ${CFG.pricing.margin}% margin, prices ${CFG.pricing.ending==="none"?"unrounded":"ending "+CFG.pricing.ending}

${shape}

The owner said: "${q}"

Return ONLY valid JSON, no prose or fences:
{"reply":string,"ops":[ ... ]}

Operations. Each takes a "where" selector rather than a list of items — describe the RULE and the
terminal will work out which products match. Never try to enumerate products yourself.

"where" accepts any combination of:
  {"dept":string, "group":string, "nameContains":string, "nameMatches":"<regex>",
   "upcs":[string], "noBarcode":true, "noCost":true, "priceOver":number, "priceUnder":number,
   "taxRate":string}
An empty object {} means every product in the pricebook.

Available ops:
 {"op":"rename","where":{...},"find":"<regex>","replace":string}
 {"op":"rename","where":{...},"strip":"<regex>"}   or "strip":["<regex>","<regex>"] — removes matches
 {"op":"setPrice","where":{...},"mode":"set"|"add"|"multiply"|"margin","value":number,"round":"x9"|"99"|"none"}
 {"op":"move","where":{...},"dept":string}
 {"op":"setField","where":{...},"field":"ebt"|"weighed"|"cost"|"restrictId","value":any}
 {"op":"setGroup","where":{...},"group":string}
 {"op":"delete","where":{...}}
 {"op":"addItems","dept":string,"food":boolean,"items":[{"n":string,"p":number,"upc":string,"age":number|null,"wt":boolean|null,"ebt":boolean|null,"dep":number|null}]}
 {"op":"newDept","n":string,"tax":string,"food":boolean}
 {"op":"setDeptTax","dept":string,"tax":string}
 {"op":"delDept","dept":string}
 {"op":"addPromo","n":string,"upcs":[string],"qty":number,"price":number}

Rules:
- "reply": one or two sentences to the owner. Say what you're proposing. If the request is ambiguous,
  ask and return an empty ops array — asking beats guessing at someone's pricebook.
- Prefer one op with a broad selector over many narrow ones. "Raise every drink 25 cents" is a single
  setPrice with {"dept":"Beverages"}, not twenty operations.
- Use "add" with mode for money amounts, "multiply" for percentages (1.1 is +10%), "margin" to
  reprice from cost.
- For renames, regex is available and preferred. To clear trailing case wording from every name at
  once: {"op":"rename","where":{},"strip":"\\\\s*[\\\\(\\\\[][^)\\\\]]*(case|pack|pk|ct)[^)\\\\]]*[\\\\)\\\\]]"}
  Put multiple patterns in an array rather than joining them with a pipe.
- "delete" and "delDept" destroy data. Only use them when the owner clearly asked to remove things.
${itemRules()}
- Never create a fuel department.`}]});
      const ops=(Array.isArray(res.ops)?res.ops:[]).map(o=>({...o,on:true}));
      CHAT.push({role:"ai",text:res.reply||"Here's what I'd change.",ops});
      PROPOSAL=ops.length?{ops}:null;
    }catch(e){
      CHAT.push({role:"note",text:"That didn't come back in a usable form. Try naming the department or the pattern directly."});
    }
    CHATBUSY=false;drawConfig();
  }
}
/* Suggestions built from this store, not from a convenience store somebody
   imagined. A clothing shop should never be told to reprice its energy drinks. */
function suggestions(){
  const depts=CFG.depts.filter(d=>!d.fuel);
  const names=depts.map(d=>d.n);
  const has=re=>names.find(n=>re.test(n));
  const biggest=depts.slice().sort((a,b)=>
    CFG.plus.filter(p=>p.deptId===b.id).length-CFG.plus.filter(p=>p.deptId===a.id).length)[0];
  const withCost=CFG.plus.filter(p=>p.cost>0).length;
  const caseNames=CFG.plus.filter(p=>/\b(case|pack|pk|ct)\b/i.test(p.n)).length;
  const noBarcode=CFG.plus.filter(p=>!p.upc).length;
  const starters=CFG.plus.filter(p=>p.starter).length;
  const rates=CFG.taxRates.filter(r=>r.rate>0);
  const type=(A.type||"").toLowerCase();
  const out=[];

  /* Things that are actually wrong come first — they're the useful ones. */
  if(starters)out.push(`Delete the ${starters} example products so I can load my real pricebook`);
  if(caseNames>2)out.push("Strip the case and pack wording out of every product name");
  if(withCost>2)out.push(`Reprice everything with a cost at ${CFG.pricing.margin}% margin, ending in 9`);
  if(noBarcode>3)out.push(`Show me the ${noBarcode} products with no barcode`);

  /* Then something shaped like this kind of shop. */
  if(/cloth|apparel|boutique|shoe/.test(type)){
    out.push("Set up sizes as a required modifier group on everything");
    if(biggest)out.push(`Group ${biggest.n} by brand instead of by type`);
    out.push("Move anything under $15 into an Accessories department");
  } else if(/liquor|wine|beer/.test(type)){
    out.push("Put every spirit on a 21+ age check");
    out.push("Split wine out of Beer & Wine into its own department");
    out.push("Add a mix-and-match deal: any 6 bottles of wine for 10% off");
  } else if(/tobacco|vape|smoke/.test(type)){
    out.push("Put every product on a 21+ age check");
    if(biggest)out.push(`Group ${biggest.n} by brand`);
    out.push("Move anything under $8 into an Accessories department");
  } else if(/caf|coffee|restaurant|food/.test(type)){
    out.push("Add size and milk options as modifier groups on the drinks");
    out.push("Add a breakfast menu for the morning rush");
    if(rates.length>1)out.push(`Move prepared food onto the ${rates[rates.length-1].n} rate`);
  } else if(/grocer|market/.test(type)){
    if(rates.length>1)out.push(`Check every department is on the right tax rate`);
    out.push("Move candy and soft drinks out of Grocery — they're taxed differently");
    out.push("Flag the SNAP-eligible staples as EBT");
  } else if(/hardware/.test(type)){
    out.push("Group fasteners by size instead of by type");
    out.push("Move anything under $5 into a Small Parts department");
  } else {
    if(biggest)out.push(`Raise every price in ${biggest.n} by 5%`);
    if(has(/drink|beverage/))out.push("Move all the energy drinks into their own department");
  }

  /* And one that uses a rate they actually have. */
  if(rates.length>1&&!out.some(s=>/tax rate/.test(s)))
    out.push(`Put candy and soft drinks on the ${
      (rates.find(r=>/candy|soft/i.test(r.n))||rates[0]).n} tax rate`);

  return out.slice(0,5);
}
function chatBubble(m){
  if(m.role==="note")return `<div class="cnote">${esc(m.text)}</div>`;
  return `<div class="cmsg ${m.role}"><div class="cwho">${m.role==="you"?"You":"Assistant"}</div>
    <div class="ctext">${esc(m.text)}</div></div>`;
}
function proposalCard(){
  /* First pass seeds the per-item selections, second pass reflects them. */
  let previews=previewAll(PROPOSAL.ops);
  PROPOSAL.ops.forEach((o,i)=>{
    if(!o.sel)o.sel=new Set(previews[i].samples.map(s=>s.id).filter(Boolean));
  });
  previews=previewAll(PROPOSAL.ops);
  PROPOSAL.pv=previews;
  const countFor=(o,p)=>p.samples.length&&p.samples[0].id
    ? [...o.sel].length : (o.on?p.count:0);
  const affected=PROPOSAL.ops.reduce((a,o,i)=>a+(o.on?countFor(o,previews[i]):0),0);
  /* Count what is actually destroyed separately from what is merely changed.
     A button reading "this deletes 24 products" when six are being deleted and
     eighteen are being moved is worse than no warning at all. */
  const doomed=PROPOSAL.ops.reduce((a,o,i)=>
    a+(o.on&&previews[i].danger?countFor(o,previews[i]):0),0);
  const changed=affected-doomed;

  return `<div class="proposal">
    <div class="phead">Proposed — ${changed} to change${doomed?`, <span class="doom">${doomed} to delete</span>`:""}</div>
    <div class="plist">${PROPOSAL.ops.map((o,i)=>{
      const p=previews[i];
      const perItem=p.samples.length&&p.samples[0].id;
      const chosen=perItem?[...o.sel].length:p.count;
      const open=OPEN_OPS.has(i);
      const shown=open?p.samples:p.samples.slice(0,6);
      return `<div class="prow ${o.on?"":"off"} ${p.danger?"danger":""}">
        <label class="ophead"><input type="checkbox" ${o.on?"checked":""} onchange="__w.togOp(${i})">
          <span><b>${esc(p.label)}</b>
          ${perItem&&chosen!==p.count?`<em class="picked">${chosen} of ${p.count} selected</em>`:""}
          ${p.note?`<em>${esc(p.note)}</em>`:""}
          ${p.count===0&&!p.note?`<em class="none">Nothing in the pricebook matches this.</em>`:""}
          ${p.count===0?`<em class="none">Nothing to do — it can be left unticked.</em>`:""}</span></label>
        ${perItem&&o.on?`
          <div class="rowtools">
            <button onclick="__w.selAll(${i},true)">Select all</button>
            <button onclick="__w.selAll(${i},false)">None</button>
          </div>
          <div class="samples">${shown.map(s=>`
            <label class="sam ${o.sel.has(s.id)?"":"skip"}">
              <input type="checkbox" ${o.sel.has(s.id)?"checked":""} onchange="__w.togItem(${i},'${s.id}')">
              ${s.name?`<span class="samname">${esc(s.name)}</span>`:""}
              <span class="was">${esc(s.before)}</span>
              <span class="arw">→</span><span class="now">${esc(s.after)}</span></label>`).join("")}
            ${p.count>p.samples.length?`<div class="more">and ${p.count-p.samples.length} more, all included</div>`:""}
          </div>
          ${p.samples.length>6?`<button class="showall" onclick="__w.toggleOp(${i})">${
            open?"Show fewer":`Show all ${p.samples.length}`}</button>`:""}`
        :p.samples.length?`<div class="samples">${p.samples.slice(0,6).map(s=>
            `<div class="sam">${s.name?`<span class="samname">${esc(s.name)}</span>`:""}
             <span class="was">${esc(s.before)}</span>
             <span class="arw">→</span><span class="now">${esc(s.after)}</span></div>`).join("")}</div>`:""}
      </div>`}).join("")}</div>
    <div class="pact">
      <button class="mini ${doomed?"":"ok"}" style="${doomed?"border-color:var(--void);color:var(--void)":"color:#0D1F18"}"
        onclick="__w.applyOps()" ${affected?"":"disabled"}>
        ${doomed
          ? `Apply${changed?` — change ${changed}`:""}, delete ${doomed}`
          : `Apply to ${affected} product${affected===1?"":"s"}`}</button>
      <button class="mini" onclick="__w.dropOps()">Discard</button>
      ${doomed?`<em class="doom">${doomed} product${doomed===1?"":"s"} will be permanently removed.
        Undo is available afterwards.</em>`:`<em>Or type below to adjust it first.</em>`}
    </div></div>`;
}
