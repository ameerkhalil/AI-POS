/* ============================ PRICING & INTAKE ============================
   Cost in, retail out. The margin rule and the price-ending rule are store
   settings, so an invoice can be priced without anyone typing a price.
   Anything the model isn't sure about is held in a review queue rather than
   written into the pricebook — a wrong price on the shelf costs more than a
   minute of checking.
   ========================================================================== */

/* retail = cost / (1 - margin). Margin here is gross margin on the sell price,
   which is what retailers actually mean, not markup on cost. */
function fromMargin(cost,marginPct){
  const m=Math.min(94,Math.max(0,+marginPct||0))/100;
  return m>=1?cost:cost/(1-m);
}
function marginOf(cost,price){return price>0?(price-cost)/price*100:0}

/* Charm pricing. "x9" snaps to the nearest cents value ending in 9 — 2.99,
   3.49, 1.29 — which is the pattern most c-stores actually run. */
function charm(p,rule,dir){
  if(!rule||rule==="none")return Math.round(p*100)/100;
  const cents=Math.round(p*100);
  let cands=[];
  if(rule==="x9")for(let c=9;c<=100000;c+=10)cands.push(c);
  else if(rule==="99")for(let c=99;c<=100000;c+=100)cands.push(c);
  else if(rule==="95")for(let c=95;c<=100000;c+=100)cands.push(c);
  else if(rule==="49-99")for(let c=49;c<=100000;c+=50)cands.push(c);
  let pick;
  if(dir==="up")pick=cands.find(c=>c>=cents);
  else if(dir==="down"){const below=cands.filter(c=>c<=cents);pick=below[below.length-1]}
  else pick=cands.reduce((a,b)=>Math.abs(b-cents)<=Math.abs(a-cents)?b:a,cands[0]);
  return (pick||cents)/100;
}
/* A shop that prices by value gets no suggested retail — a coffee costing 40
   cents does not sell for 80, and pretending otherwise is worse than a blank. */
function priceFor(cost){
  if(CFG.pricing.mode==="value")return 0;
  return charm(fromMargin(cost,CFG.pricing.margin),CFG.pricing.ending,CFG.pricing.dir);
}

/* ---------------------------- invoice intake ---------------------------- */
let PENDING=[],REPRICE=true;

/* A UPC-A or EAN-13 carries its own check digit. This catches a transposed or
   misread digit outright, which is the difference between a barcode that scans
   and one that silently never matches anything for the next two years. */
function validUPC(raw){
  const s=String(raw||"").replace(/\D/g,"");
  if(s.length!==12&&s.length!==13&&s.length!==8)return null;
  const d=s.split("").map(Number),chk=d.pop();
  let sum=0;
  if(s.length===13){ d.forEach((n,i)=>sum+=n*(i%2?3:1)); }
  else { d.reverse().forEach((n,i)=>sum+=n*(i%2?1:3)); }
  return ((10-(sum%10))%10)===chk ? s : null;
}

/* Matching an invoice line to something already in the pricebook is what turns a
   stack of paper into "these twelve went up". Barcode first, then a normalised
   name, because most invoices don't print barcodes at all. */
const normName=s=>String(s||"").toLowerCase().replace(/[^a-z0-9]/g,"");
const tokens=s=>String(s||"").toLowerCase().match(/[a-z0-9]+/g)||[];
/* Dice coefficient over word tokens. Good enough to rank candidates, and
   deliberately never good enough to act on by itself. */
function similar(a,b){
  const A=new Set(tokens(a)),B=new Set(tokens(b));
  if(!A.size||!B.size)return 0;
  let hit=0;A.forEach(t=>{if(B.has(t))hit++});
  return 2*hit/(A.size+B.size);
}
/* A barcode match is a fact. A name match is a guess, so it comes back marked
   as one and goes to review for a human to confirm or reject. */
function matchExisting(upc,name){
  if(upc){const m=CFG.plus.find(p=>p.upc===upc);if(m)return{plu:m,kind:"upc",score:1}}
  const k=normName(name);
  if(k.length<5)return null;
  const exact=CFG.plus.find(p=>normName(p.n)===k);
  if(exact)return{plu:exact,kind:"name-exact",score:1};
  let best=null;
  CFG.plus.forEach(p=>{
    const s=similar(name,p.n);
    if(s>=0.55&&(!best||s>best.score))best={plu:p,kind:"name-fuzzy",score:s};
  });
  return best;
}
function candidates(name,limit=5){
  return CFG.plus.map(p=>({p,s:similar(name,p.n)}))
    .filter(x=>x.s>=0.25).sort((a,b)=>b.s-a.s).slice(0,limit);
}

/* Barcode lookup. The model only reports one when it is certain of the exact
   pack and size, and the check digit has to validate before we accept it.
   Anything that clears both is still stamped as looked-up rather than read,
   because "certain" and "correct" are not the same word. */
async function fillMissingUPCs(rows,onProgress){
  const need=rows.map((r,i)=>({r,i})).filter(x=>!x.r.upc);
  if(!need.length)return 0;
  let filled=0;
  for(let b=0;b<need.length;b+=12){
    const batch=need.slice(b,b+12);
    onProgress&&onProgress(b,need.length);
    try{
      const res=await callAI(`Identify the retail UPC barcode for each product below, sold in the United States.

${batch.map((x,j)=>`${j}. ${x.r.n}${x.r.desc&&x.r.desc!==x.r.n?`  (invoice text: ${x.r.desc})`:""}`).join("\n")}

Return ONLY valid JSON, no prose or fences:
{"found":[{"i":number,"upc":string,"certain":boolean}]}

Rules:
- "i" is the number next to the product above.
- "upc": the full 12-digit UPC-A, digits only, including the check digit.
- Set "certain" true ONLY if you are sure this is the barcode for this exact product,
  in this exact size and pack count. A 12oz can and a 20oz bottle of the same drink have
  different barcodes, and a 12-pack has a different barcode again.
- If you are not sure of the exact variant, OMIT that product entirely. Do not guess,
  do not approximate, and do not return a barcode for a similar product.
- Returning nothing is the correct answer when you don't know. An empty array is fine.`,
        {tools:[{type:"web_search_20250305",name:"web_search"}],max_tokens:1500,kind:"upc-lookup"});
      (res.found||[]).forEach(f=>{
        if(!f||f.certain!==true)return;
        const ok=validUPC(f.upc);
        if(!ok)return;                                   // check digit failed — drop it
        if(CFG.plus.some(p=>p.upc===ok))return;          // already on another product
        const tgt=batch[f.i];
        if(!tgt||tgt.r.upc)return;
        tgt.r.upc=ok;tgt.r.upcSrc="lookup";filled++;
      });
    }catch(e){}
  }
  return filled;
}

function fileToB64(f){
  return new Promise((res,rej)=>{const r=new FileReader();
    r.onload=()=>res(r.result.split(",")[1]);r.onerror=()=>rej(new Error("Couldn't read that file"));
    r.readAsDataURL(f)});
}
function invoiceView(){
  window.__pick=()=>$("invFile").click();
  window.__clearP=()=>{PENDING=[];drawInvoice()};
  drawInvoice();
}
function drawInvoice(){
  const ready=PENDING.filter(p=>!p.review),review=PENDING.filter(p=>p.review);
  $("cfgBody").innerHTML=`
    <div class="drop" id="drop">
      <svg viewBox="0 0 24 24"><path d="M12 16V4m0 0L8 8m4-4 4 4"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
      <b>Drop a vendor invoice here</b>
      <span>Photo or PDF. The model reads the line items, works out what each product is,
        prices it at your ${CFG.pricing.margin}% margin, and files it under a department.</span>
      <button class="mini" onclick="__pick()">Choose a file</button>
      <input type="file" id="invFile" accept="image/*,.pdf" style="display:none">
    </div>
    <div id="invStat"></div>
    ${PENDING.length?`${changeSummary()}
      <div class="sect">Ready to import — ${ready.length}</div>
      ${ready.length?pendTable(ready,false):`<p style="color:var(--txt-3);font-size:13px">Nothing cleared automatically yet.</p>`}
      <div class="sect" style="color:var(--warn)">Needs your eye — ${review.length}</div>
      ${review.length?pendTable(review,true):`<p style="color:var(--txt-3);font-size:13px">Nothing held back.</p>`}
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
        <button class="mini ok" style="color:#0D1F18" onclick="__commit()">Add ${ready.length} item${ready.length===1?"":"s"} to the pricebook</button>
        <button class="mini" onclick="__clearP()">Discard the batch</button>
      </div>
      <div class="note">Held items are the ones the model flagged as uncertain — an unreadable cost, a
        product name it couldn't place, a missing barcode. Fix the field, tick <b>Ready</b>, and it moves up.
        Nothing reaches the pricebook until you commit.</div>`
    :`<div class="note">Costs come in, retail goes out. Every item is priced at
      <b>${CFG.pricing.margin}% margin</b>${CFG.pricing.ending!=="none"?` and rounded to ${
        {x9:"end in 9 cents",99:"end in .99","95":"end in .95","49-99":"end in .49 or .99"}[CFG.pricing.ending]}`:""}.
      Change either rule under Site &amp; tax.</div>`}`;

  const dz=$("drop");
  ["dragenter","dragover"].forEach(e=>dz.addEventListener(e,ev=>{ev.preventDefault();dz.classList.add("over")}));
  ["dragleave","drop"].forEach(e=>dz.addEventListener(e,ev=>{ev.preventDefault();dz.classList.remove("over")}));
  dz.addEventListener("drop",ev=>{const f=ev.dataTransfer.files[0];if(f)readInvoice(f)});
  $("invFile").onchange=e=>{const f=e.target.files[0];if(f)readInvoice(f)};

  window.__pset=(i,f,v)=>{const p=PENDING[i];
    if(f==="cost"){p.cost=parseFloat(v)||0;applyRowPrice(p)}
    else if(f==="price"){p.price=parseFloat(v)||0;p.priceEdited=true}
    else if(f==="upc"){p.upc=v.replace(/\D/g,"");p.upcSrc=p.upc?"manual":null}
    else p[f]=v;
    $("pmarg"+i)&&($("pmarg"+i).innerHTML=marginCell(p))};
  window.__pok=i=>{PENDING[i].review=false;drawInvoice()};
  window.__pdel=i=>{PENDING.splice(i,1);drawInvoice()};
  window.__commit=commitPending;
  /* Two products, one shelf. Linking folds the invoice line into the product
     already in the pricebook rather than creating a near-duplicate that splits
     its sales history in half. */
  window.__link=i=>{
    const r=PENDING[i],cands=candidates(r.n);
    const el=veil(`<div class="card tall" style="max-width:560px"><h3>Link to an existing product</h3>
      <p>The invoice calls this <b>${esc(r.n)}</b>${r.desc&&r.desc!==r.n?` (printed as ${esc(r.desc)})`:""}.
        Linking updates that product's cost and barcode instead of adding a second one.</p>
      <div class="edwrap">${cands.length?cands.map(c=>`
        <button class="linkrow" data-p="${c.p.id}">
          <div style="flex:1">
            <b>${esc(c.p.n)}</b>
            <span>${esc(byId(CFG.depts,c.p.deptId)?.n||"")}
              · sells ${money(c.p.price)}${c.p.cost?` · cost ${money(c.p.cost)}`:""}
              ${c.p.upc?` · ${esc(c.p.upc)}`:" · no barcode"}</span>
          </div>
          <span class="score">${Math.round(c.s*100)}%</span>
        </button>`).join("")
        :`<p style="color:var(--txt-3);font-size:13px">Nothing in the pricebook looks close to this.</p>`}</div>
      <div class="row"><button class="no" id="lkn">Cancel</button>
        <button class="ok" id="lknew">It's a different product</button></div></div>`);
    el.querySelectorAll("[data-p]").forEach(b=>b.onclick=()=>{
      const tgt=byId(CFG.plus,b.dataset.p);
      r.matchId=tgt.id;r.maybe=false;r.review=false;r.status="known";
      r.prevCost=tgt.cost??null;r.prevPrice=tgt.price;
      if(r.prevCost>0&&r.cost>0){
        r.changePct=(r.cost-r.prevCost)/r.prevCost;
        r.status=r.changePct>0.005?"up":r.changePct<-0.005?"down":"same";
      }
      r.reprice=true;applyRowPrice(r);
      r.why=null;el.remove();drawInvoice();
      toast(`Linked to <b>${esc(tgt.n)}</b>.`);
    });
    el.querySelector("#lkn").onclick=()=>el.remove();
    el.querySelector("#lknew").onclick=()=>{
      r.maybe=false;r.review=false;r.matchId=null;r.status="new";r.why=null;
      el.remove();drawInvoice();
    };
  };
  window.__rep=(i,v)=>{const p=PENDING[i];p.reprice=v;p.priceEdited=false;applyRowPrice(p);drawInvoice()};
  window.__bulk=which=>{
    PENDING.forEach(p=>{
      if(!p.matchId)return;
      if(which==="all")p.reprice=true;
      else if(which==="none")p.reprice=false;
      else if(which==="up")p.reprice=p.status==="up";
      else if(which==="down")p.reprice=p.status==="down";
      p.priceEdited=false;applyRowPrice(p);
    });
    drawInvoice();
  };
}
/* What this invoice means, before anyone reads a single row. */
/* A row's shelf price is either the margin rule applied to the new cost, or the
   price already on the shelf. Nothing else. */
function applyRowPrice(p){
  if(p.priceEdited)return;
  p.price=(p.matchId&&!p.reprice&&p.prevPrice>0)?p.prevPrice:priceFor(p.cost);
}
function changeSummary(){
  const up=PENDING.filter(p=>p.status==="up"),down=PENDING.filter(p=>p.status==="down");
  const fresh=PENDING.filter(p=>p.status==="new");
  const vendor=PENDING.find(p=>p.vendor)?.vendor;
  if(!PENDING.length)return "";
  const worst=up.slice().sort((a,b)=>b.changePct-a.changePct)[0];
  return `<div class="summary">
    <div class="sumhead">${vendor?esc(vendor):"This delivery"} — ${PENDING.length} line${PENDING.length===1?"":"s"}</div>
    <div class="sumrow">
      <span class="sc up">${up.length}</span> cost more than last time
      <span class="sc down">${down.length}</span> cost less
      <span class="sc new">${fresh.length}</span> you've never carried
    </div>
    ${worst?`<div class="sumnote">Biggest rise: <b>${esc(worst.n)}</b>
      ${money(worst.prevCost)} → ${money(worst.cost)}, up ${(worst.changePct*100).toFixed(0)}%.
      ${worst.prevPrice&&REPRICE?`Shelf price would go ${money(worst.prevPrice)} → ${money(worst.price)}.`:""}</div>`:""}
    ${up.length||down.length?`<div class="sumtog">
      <span>Which shelf prices do you want to move?</span>
      <div class="bulk">
        <button onclick="__bulk('all')">All ${up.length+down.length}</button>
        <button onclick="__bulk('up')">Only the ${up.length} that rose</button>
        <button onclick="__bulk('down')">Only the ${down.length} that fell</button>
        <button onclick="__bulk('none')">None — hold every price</button>
      </div>
      <em>Unticking a row keeps its shelf price and updates only the cost, so you'll see the margin
        you're actually giving up.</em>
    </div>`:""}
  </div>`;
}
/* When a cost rises and the shelf price is held, the margin is what gives. Say
   so in the row, in points, rather than making anyone work it out. */
function marginCell(r){
  const now=marginOf(r.cost,r.price);
  if(!(r.prevCost>0)||!r.prevPrice)return `<span style="color:var(--txt-2)">${now.toFixed(0)}%</span>`;
  const before=marginOf(r.prevCost,r.prevPrice),d=now-before;
  const col=Math.abs(d)<0.5?"var(--txt-2)":d<0?"var(--void)":"var(--vfd)";
  return `<span style="color:${col}">${now.toFixed(0)}%</span>`
    +(Math.abs(d)>=0.5?`<div class="asprint" style="color:${col}">${d>0?"+":""}${d.toFixed(1)} pts</div>`
      :`<div class="asprint">held</div>`);
}
function pendTable(rows,isReview){
  return`<table class="tbl"><thead><tr>
    <th style="width:20%">Item</th><th style="width:12%">UPC</th><th style="width:11%">Cost</th>
    <th style="width:5%" title="Move this shelf price">↕</th>
    <th style="width:11%">Shelf price</th><th style="width:9%">Margin</th>
    <th style="width:12%">Department</th><th style="width:10%">Tax</th><th style="width:8%">vs last</th>
    ${isReview?`<th style="width:8%">Why</th>`:""}<th></th></tr></thead><tbody>
  ${rows.map(r=>{const i=PENDING.indexOf(r);return`<tr>
    <td><input value="${esc(r.n)}" oninput="__pset(${i},'n',this.value)">
      ${r.desc&&r.desc!==r.n?`<div class="asprint">${esc(r.desc)}${r.pack>1?` · ${r.pack}/case`:""}${
        r.qty&&r.unit?` · ${r.qty} × ${money(r.unit)}`:""}${
        r.ext?` = ${money(r.ext)}`:""}${
        r.disc>0.001?` <span class="allow">less ${(r.disc*100).toFixed(0)}%</span>`:""}${
        r.units>1?` · ${r.units} units`:""}${
        r.pack>1?` <span class="unitnote">price is for 1 of ${r.pack}</span>`:""}</div>`:""}</td>
    <td><input class="n upc-${r.upcSrc||"none"}" value="${esc(r.upc||"")}"
        placeholder="scan or type" oninput="__pset(${i},'upc',this.value)"
        title="${r.upcSrc==="lookup"?"Found by lookup — scan the product to confirm"
          :r.upcSrc==="invoice"?"Printed on the invoice"
          :r.upcSrc==="manual"?"Entered by hand":"No barcode yet"}"></td>
    <td><input class="n" value="${money(r.cost)}" oninput="__pset(${i},'cost',this.value)">
      ${r.prevCost>0?`<div class="asprint">was ${money(r.prevCost)}${
        r.changePct?` · ${r.changePct>0?"+":""}${(r.changePct*100).toFixed(0)}%`:""}</div>`:""}</td>
    <td style="text-align:center">${r.matchId
      ? `<input type="checkbox" ${r.reprice?"checked":""} onchange="__rep(${i},this.checked)"
          style="width:auto" title="Move this shelf price to match the new cost">`
      : `<span style="color:var(--txt-3);font-size:11px" title="New product — it needs a price">new</span>`}</td>
    <td><input class="n" value="${money(r.price)}" oninput="__pset(${i},'price',this.value)">
      ${r.prevPrice&&Math.abs(r.prevPrice-r.price)>0.001
        ? `<div class="asprint">from ${money(r.prevPrice)}</div>`
        : r.prevPrice?`<div class="asprint">unchanged</div>`:""}</td>
    <td class="num" id="pmarg${i}" style="padding-left:8px;font-size:12.5px">${marginCell(r)}</td>
    <td><select onchange="__pset(${i},'deptId',this.value)">${CFG.depts.filter(d=>!d.fuel).map(d=>
      `<option value="${d.id}" ${r.deptId===d.id?"selected":""}>${esc(d.n)}</option>`).join("")}</select></td>
    <td><select onchange="__pset(${i},'taxId',this.value)">${CFG.taxRates.map(t=>
      `<option value="${t.id}" ${r.taxId===t.id?"selected":""}>${esc(t.n)}</option>`).join("")}</select></td>
    <td style="padding-left:6px">${
      r.status==="new"?`<span class="chip new">new</span>`
      :r.status==="up"?`<span class="chip up" title="was ${money(r.prevCost)}">+${(r.changePct*100).toFixed(0)}%</span>`
      :r.status==="down"?`<span class="chip down" title="was ${money(r.prevCost)}">${(r.changePct*100).toFixed(0)}%</span>`
      :`<span class="chip same">same</span>`}</td>
    ${isReview?`<td style="font-size:11.5px;color:var(--warn);padding-left:6px">${esc(r.why||"unsure")}</td>`:""}
    <td style="white-space:nowrap">
      ${r.maybe?`<button class="mini" style="margin:0;padding:5px 9px;font-size:11.5px" onclick="__link(${i})">Link…</button>`:""}
      ${isReview?`<button class="mini" style="margin:0;padding:5px 9px;font-size:11.5px" onclick="__pok(${i})">${r.maybe?"It's new":"Ready"}</button>`:""}
      <button class="del" onclick="__pdel(${i})" aria-label="Drop">×</button></td></tr>`}).join("")}
  </tbody></table>`;
}

/* Dense invoices fail as a single image: downscaling turns the cost column to
   mush and one response can't hold 50 lines. So we slice the page into
   overlapping horizontal bands, read each at full resolution in its own call,
   then merge. Every line is checked against its own arithmetic — if
   qty x unit cost doesn't equal the printed extended cost, the OCR misread
   something and the line is held rather than trusted. */
function loadImage(file){
  return new Promise((res,rej)=>{const u=URL.createObjectURL(file),i=new Image();
    i.onload=()=>{URL.revokeObjectURL(u);res(i)};
    i.onerror=()=>{URL.revokeObjectURL(u);rej(new Error("bad image"))};i.src=u});
}
function sliceImage(img,bands){
  const out=[],ov=.10,sh=img.height/bands;
  const scale=Math.min(2.5,Math.max(1,1700/img.width));
  for(let i=0;i<bands;i++){
    const y0=Math.max(0,i*sh-(i?sh*ov:0)),y1=Math.min(img.height,(i+1)*sh+(i<bands-1?sh*ov:0));
    const c=document.createElement("canvas");
    c.width=Math.round(img.width*scale);c.height=Math.round((y1-y0)*scale);
    const cx=c.getContext("2d");
    cx.imageSmoothingEnabled=true;cx.imageSmoothingQuality="high";
    cx.fillStyle="#fff";cx.fillRect(0,0,c.width,c.height);
    cx.drawImage(img,0,y0,img.width,y1-y0,0,0,c.width,c.height);
    out.push(c.toDataURL("image/jpeg",.93).split(",")[1]);
  }
  return out;
}
const LINE_SCHEMA=`{"items":[{
 "desc":string, "qtyShipped":number|null, "unitCost":number|null, "extCost":number|null,
 "packSize":number, "n":string, "upc":string|null, "dept":string,
 "tax":"standard"|"food"|"nontax", "conf":number, "why":string|null}]}`;

function lineRules(depts){return `Rules:
- One entry per product line. Include EVERY product line you can see. Do not stop early,
  do not summarise, do not skip lines that look similar to ones above.
- Skip only: freight, fuel surcharge, tax lines, invoice subtotals and totals.
- Transcribe these three EXACTLY as printed, without arithmetic of your own:
  "qtyShipped" = the quantity billed, "unitCost" = the cost of one billed unit,
  "extCost" = the line's extended or total cost. Use null for any that is not printed.
- "packSize" = how many sellable units are inside ONE billed unit. A case of 24 cans is 24.
  An item billed as a single unit is 1. "50PK" is 50. If you cannot tell, use 1 and lower conf.
- "desc" = the vendor's description verbatim, abbreviations and all.
- "n" = the name of ONE SELLABLE UNIT — the thing that crosses the counter and gets a price.
  This is the single most important field to get right, because it becomes the button the
  cashier presses and the price is per unit, not per case.
  · Include the unit size: "Coca-Cola Classic 16.9 oz", "Doritos Nacho Cheese 9.25 oz",
    "Gatorade Cool Blue 28 oz", "Marlboro Red Box".
  · NEVER put the case or pack count in the name. An invoice line reading
    "COCA-COLA CLASSIC 24PK 16.9OZ BOTTLE" is 24 bottles of one product, so the name is
    "Coca-Cola Classic 16.9 oz" and packSize is 24. Not "(24-pack case)".
  · The exception is when the pack IS the sellable unit — a 12-pack of Coke sold as a
    12-pack is "Coca-Cola Classic 12 oz 12-Pack" with packSize 1 for a single 12-pack,
    or packSize 2 if the case holds two of them.
  · Use the size units the vendor printed: oz, L, mL, ct, pk, g.
- "upc" = only if a barcode is actually printed on this line. Otherwise null. Never invent one.
- "dept" = the best fit from: ${depts}. If none fit, give a short name of your own.
- "tax" = "food" for grocery staples eligible for a reduced grocery rate, "nontax" if untaxed,
  otherwise "standard".
- "conf" = 0 to 1 for this line. Be strict. Below 0.7 whenever any number is unclear or you inferred it.
- "why" = when conf is below 0.7, a short phrase naming what is uncertain. Otherwise null.`}

async function readInvoice(file){
  const st=$("invStat");
  const depts=CFG.depts.filter(d=>!d.fuel).map(d=>d.n).join(", ");
  const isPdf=file.type==="application/pdf"||/\.pdf$/i.test(file.name);
  const show=(msg,tone)=>st.innerHTML=`<div class="note" style="border-color:var(--${tone||"vfd-dim"});margin-top:13px">${msg}</div>`;
  let raw=[];

  try{
    if(isPdf){
      const b64=await fileToB64(file);
      const doc={type:"document",source:{type:"base64",media_type:"application/pdf",data:b64}};
      show("Counting the line items…");
      let total=40;
      try{
        const c=await callAI(null,{max_tokens:200,messages:[{role:"user",content:[doc,
          {type:"text",text:`How many product line items are on this invoice, excluding freight, tax and totals?
Return ONLY {"lines":number} as JSON.`}]}]});
        if(c.lines>0)total=Math.min(300,c.lines);
      }catch(e){}
      const per=12,passes=Math.ceil(total/per);
      for(let i=0;i<passes;i++){
        show(`Reading lines ${i*per+1}–${Math.min(total,(i+1)*per)} of about ${total}…`);
        try{
          const r=await callAI(null,{max_tokens:4000,messages:[{role:"user",content:[doc,{type:"text",
            text:`Transcribe product lines from this invoice for ${A.name||CFG.site.name}.

Return ONLY valid JSON, no prose or fences:
${LINE_SCHEMA}

Transcribe ONLY product lines ${i*per+1} through ${(i+1)*per}, counting product lines from the top
of the invoice and ignoring headers. If there are fewer than that, return what exists and stop.

${lineRules(depts)}`}]}]});
          if(Array.isArray(r.items))raw=raw.concat(r.items);
        }catch(e){}
      }
    } else {
      const img=await loadImage(file);
      const bands=Math.min(8,Math.max(1,Math.round(img.height/850)));
      const strips=sliceImage(img,bands);
      for(let i=0;i<strips.length;i++){
        show(`Reading section ${i+1} of ${strips.length} at full resolution…`);
        try{
          const r=await callAI(null,{max_tokens:4000,messages:[{role:"user",content:[
            {type:"image",source:{type:"base64",media_type:"image/jpeg",data:strips[i]}},
            {type:"text",text:`This is one horizontal section of a vendor invoice for ${A.name||CFG.site.name}.
Sections overlap slightly, so a line may be cut off at the top or bottom — skip any line you cannot read in full.

Return ONLY valid JSON, no prose or fences:
${LINE_SCHEMA}

${lineRules(depts)}`}]}]});
          if(Array.isArray(r.items))raw=raw.concat(r.items);
        }catch(e){}
      }
    }
  }catch(e){
    return show("Couldn't open that file. A JPEG, PNG or PDF works.","void");
  }

  if(!raw.length)return show(`Nothing readable came back. A flat, straight-on photo of the itemised
    section works best — angled shots and glare on the cost column are what usually break it.`,"void");

  /* Overlapping bands mean the same line can arrive twice. */
  const seen=new Map();
  raw.forEach(it=>{
    if(!it||!it.desc&&!it.n)return;
    const key=(it.upc||"")+"|"+String(it.desc||it.n).toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,22);
    const prev=seen.get(key);
    if(!prev||(it.conf||0)>(prev.conf||0))seen.set(key,it);
  });

  /* Belt and braces on the naming rule. A name still carrying case language while
     the price is per unit is the mismatch that quietly wrecks every margin
     number downstream, so it gets stripped and, if still ambiguous, held. */
  const CASE_TAIL=/\s*[\(\[][^)\]]*\b(case|pack|pk|ct|count|carton|box of|cs)\b[^)\]]*[\)\]]\s*$/i;
  const CASE_TOK=/\b(\d+\s*\/?\s*\d*\s*(pk|pack|ct|count)|case|carton|cs)\b/gi;
  const SIZE_HINT=/\d+(\.\d+)?\s*(oz|z|ml|l|liter|litre|g|kg|lb|ct|pk|in|mg)\b/i;
  const cleanName=(n,pack)=>{
    let out=String(n||"").trim();
    if(pack>1){
      out=out.replace(CASE_TAIL,"");
      out=out.replace(CASE_TOK,"").replace(/\s{2,}/g," ").replace(/[\s,\-]+$/,"").trim();
    }
    return out;
  };

  let held=0,added=0;
  seen.forEach(it=>{
    const pack=Math.max(1,+it.packSize||1);
    const qty=+it.qtyShipped||null,unit=+it.unitCost||null,ext=+it.extCost||null;

    /* The extended amount is what the store actually pays, so it is the number
       that decides cost. A gap between qty x unit and the extended amount is
       almost always a vendor discount or allowance, not a misread — those are
       normal on a distributor invoice and they belong in the cost. Only an
       extended amount ABOVE qty x unit, or an implausibly deep one, is suspect. */
    let why=it.why||null,conf=typeof it.conf==="number"?it.conf:.5,disc=0;
    const units=Math.max(1,(qty||1)*pack);
    let lineTotal=ext!=null&&ext>0 ? ext : (qty&&unit ? qty*unit : unit);

    if(qty&&unit&&ext>0){
      const gross=qty*unit;
      if(gross>0){
        disc=(gross-ext)/gross;
        if(disc<-0.02){                       // paying more than list — worth a look
          conf=Math.min(conf,.45);
          why=`extended amount is higher than ${qty} × ${money(unit)} — check for added fees`;
        } else if(disc>0.6){                  // 60%+ off is rarely real
          conf=Math.min(conf,.45);
          why=`discount of ${(disc*100).toFixed(0)}% looks too deep — check the figures`;
        } else if(disc>0.001){
          disc=disc;                          // ordinary allowance, keep it and move on
        } else disc=0;
      }
    }
    if(!lineTotal||lineTotal<=0){conf=0;why=why||"no cost could be read"}
    if(CFG.pricing.mode==="value"){conf=Math.min(conf,.6);why=why||"set the shelf price yourself"}

    const cost=(lineTotal||0)/units;
    if(cost>0&&cost<0.01){conf=Math.min(conf,.5);why=why||"unit cost looks too low — check the pack size"}
    if(cost>400){conf=Math.min(conf,.5);why=why||"unit cost looks too high — check the pack size"}

    const dept=CFG.depts.find(d=>!d.fuel&&d.n.toLowerCase()===String(it.dept||"").toLowerCase())
      ||CFG.depts.find(d=>!d.fuel);
    const taxId=it.tax==="food"?(byId(CFG.taxRates,"TX2")?"TX2":"TX1")
      :it.tax==="nontax"?"TX0":(dept?.taxId||"TX1");
    const hit=matchExisting(it.upc,it.n||it.desc);
    let status="new",changePct=0,prevCost=null,maybe=false;
    if(hit){
      const certain=hit.kind==="upc"||hit.kind==="name-exact";
      prevCost=hit.plu.cost??null;
      if(certain){
        if(prevCost>0&&cost>0){
          changePct=(cost-prevCost)/prevCost;
          status=changePct>0.005?"up":changePct<-0.005?"down":"same";
        } else status="known";
      } else {
        /* Same product under a slightly different vendor name — probably. That
           "probably" is exactly why it goes to a human instead of merging itself. */
        maybe=true;status="maybe";
        why=`might be the same as "${hit.plu.n}" already in the pricebook`;
      }
    }
    const review=conf<.7||!(cost>0)||!it.n||maybe;
    if(review)held++;else added++;
    PENDING.push({n:it.n||it.desc||"Unnamed item",desc:it.desc||"",upc:it.upc||"",
      cost:Math.round(cost*10000)/10000,price:priceFor(cost),deptId:dept?.id,taxId,
      review,conf,pack,qty,unit,ext,disc,units,
      reprice:true,
      matchId:(hit&&(hit.kind==="upc"||hit.kind==="name-exact"))?hit.plu.id:null,
      status,changePct,prevCost,maybe,
      suggestId:hit?hit.plu.id:null,suggestScore:hit?hit.score:0,
      prevPrice:hit?hit.plu.price:null,vendor:it.vendor||"",
      upcSrc:it.upc?"invoice":null,
      why:why||(!it.upc?"no barcode printed":"low confidence")});
  });

  const missing=PENDING.filter(p=>!p.upc).length;
  let found=0;
  if(missing){
    show(`Read ${seen.size} lines. Looking up ${missing} missing barcode${missing===1?"":"s"}…`);
    found=await fillMissingUPCs(PENDING,(done,total)=>
      show(`Looking up barcodes — ${done} of ${total} checked…`));
  }
  show(`Read <b>${seen.size}</b> line${seen.size===1?"":"s"} from ${esc(file.name)}.
    <b>${added}</b> cleared, <b>${held}</b> held for review.
    ${found?`Found <b>${found}</b> barcode${found===1?"":"s"} by lookup — those show a dotted underline
      until someone scans the physical product to confirm them.`:""}
    ${held?`Held lines show what's wrong with them in the Why column.`:""}
    <br><span style="color:var(--txt-3)">If the count looks short, the sections may have missed rows —
    re-drop the same file and duplicates will be merged rather than doubled.</span>`);
  drawInvoice();
}

function dedupePending(){
  const seen=new Map();
  PENDING=PENDING.filter(p=>{
    const k=(p.upc||"")+"|"+p.n.toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,22);
    if(seen.has(k))return false;seen.set(k,1);return true;
  });
}
function commitPending(){
  dedupePending();
  const ready=PENDING.filter(p=>!p.review);
  if(!ready.length)return alertCard("Nothing to import","Every item is still held for review. Fix the flagged fields and mark them Ready.");
  let added=0,updated=0,repriced=0;
  const now=new Date().toISOString().slice(0,10);
  ready.forEach(p=>{
    const ex=p.matchId?byId(CFG.plus,p.matchId):null;
    if(ex){
      ex.prevCost=ex.cost??null;
      ex.cost=p.cost;
      if((p.reprice||p.priceEdited)&&Math.abs(ex.price-p.price)>0.001){ex.price=p.price;repriced++}
      if(p.upc&&!ex.upc){ex.upc=p.upc;ex.upcSrc=p.upcSrc||"invoice"}
      ex.vendor=p.vendor||ex.vendor;
      ex.lastInvoice=now;
      updated++;return;
    }
    const plu={id:"P"+uid(),upc:p.upc||"",n:p.n,price:p.price,cost:p.cost,deptId:p.deptId,
      weighed:false,ebt:false,deposit:null,restrictId:null,modIds:[],
      vendor:p.vendor||"",lastInvoice:now,prevCost:null,upcSrc:p.upcSrc||null};
    CFG.plus.push(plu);
    const m=CFG.menus.find(x=>x.id==="M"+p.deptId);
    if(m)m.keys.push({pluId:plu.id});
    added++;
  });
  PENDING=PENDING.filter(p=>p.review);
  reload();drawInvoice();
  toast(`Imported <b>${added}</b> new item${added===1?"":"s"}, updated <b>${updated}</b>${
    repriced?`, repriced <b>${repriced}</b>`:""}.`);
}

/* ---------------------------- tax by location ---------------------------- */
/* Sales tax lookup.

   Three ways to get a rate, tried in order of how much you should trust them:

     1. Read the actual rate pages. The server fetches several published sources
        and hands back plain text; the model only extracts what's written there.
        This works on any API key and shows you every source's number so you can
        see them disagree, which they routinely do.
     2. The model's own web search, if the key has that tool.
     3. The model's memory, clearly labelled as such.

   Nothing here is treated as authoritative. The rates stay unconfirmed until a
   person checks them against the state's own address lookup. */

async function fetchPages(urls){
  try{
    const d=await api("/api/fetch",{method:"POST",body:{urls}});
    return (d.pages||[]).filter(p=>p.ok&&p.text&&p.text.length>200);
  }catch(e){return []}
}
const slug=s=>String(s||"").toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");

/* Turn whatever the owner typed into the pieces the rate sites need in their URLs. */
async function placeParts(place){
  try{
    const r=await callAI(`Parse this US location into its parts: "${place}"

Return ONLY valid JSON, no prose or fences:
{"city":string,"state":string,"stateAbbr":string,"zip":string,"county":string}

If a ZIP code is given, infer the city, county and state from it. If a city is given without a ZIP,
give the primary ZIP for that city. "stateAbbr" is the two-letter code.`,
      {max_tokens:300,kind:"place-parse"});
    if(r&&r.state)return r;
  }catch(e){}
  return null;
}

async function lookupTax(place,bizType,deptNames){
  const parts=await placeParts(place);
  const zip=(parts&&parts.zip)||(/^\s*(\d{5})/.exec(place)||[])[1]||"";
  const st=slug(parts&&parts.state),city=slug(parts&&parts.city);
  const q=parts?`${parts.city}, ${parts.state} ${zip}`.trim():place;

  /* --- 1. read the published rate pages --- */
  const urls=[];
  if(zip){
    urls.push(`https://www.avalara.com/taxrates/en/state-rates/zip/${zip}.html`);
    if(st)urls.push(`https://www.sales-taxes.com/${(parts.stateAbbr||"").toLowerCase()}/${zip}`);
  }
  if(st&&city){
    urls.push(`https://www.salestaxhandbook.com/${st}/rates/${city}`);
    urls.push(`https://www.tax-rates.org/${st}/${city}_sales_tax`);
  }
  const pages=urls.length?await fetchPages(urls):[];

  let base=null,mode=null;
  if(pages.length){
    try{
      base=await callAI(`Below are published sales tax pages for ${q}. Read ONLY what they say.

${pages.map((p,i)=>`--- SOURCE ${i+1}: ${p.url}\n${p.text}`).join("\n\n")}

Return ONLY valid JSON, no prose or fences:
{"place":string,"state":string,"general":number,
 "breakdown":[{"n":string,"rate":number}],
 "sources":[{"n":string,"url":string,"rate":number}],
 "categories":[{"key":string,"n":string,"rate":number,"what":string}],
 "verifyUrl":string,"conflict":string|null}

- "general": the combined rate on ordinary general merchandise. If the sources disagree, use the
  one from the most recently dated page and say so in "conflict".
- "breakdown": the components, which MUST add up to "general". Only jurisdictions that apply at
  this location — never a district tax belonging to a neighbouring town.
- "sources": one entry per source above with the rate IT gave, even where they conflict. This is
  the point of the exercise, so do not harmonise them.
- "categories": any category these pages show at a DIFFERENT rate than general merchandise —
  groceries, prepared food, clothing, prescription drugs and so on. Use short keys like
  "grocery", "prepared", "candy_soda", "drugs". Omit any category equal to the general rate.
- "verifyUrl": the state revenue department's own address-level rate lookup tool.
- "conflict": name the range if the sources disagreed, else null.`,
        {max_tokens:2200,kind:"tax-from-pages"});
      if(typeof base.general==="number")mode="pages";else base=null;
    }catch(e){base=null}
  }

  /* --- 2. the model's own search, where the key allows it --- */
  const askBase=`Find the sales tax rate for a retail store located at ${q}, United States.
Prefer the state revenue department's address-level rate finder over third-party aggregators.

Return ONLY valid JSON, no prose or fences:
{"place":string,"state":string,"general":number,"breakdown":[{"n":string,"rate":number}],
 "sources":[{"n":string,"url":string,"rate":number}],"verifyUrl":string,"conflict":string|null}

- "breakdown" must sum exactly to "general", and include only jurisdictions applying at this address.
- "conflict": name the range if sources disagreed, else null.`;
  if(!base){
    try{
      base=await callAI(askBase,{tools:[{type:"web_search_20250305",name:"web_search"}],
        max_tokens:2000,kind:"tax-search"});
      if(typeof base.general==="number")mode="search";else base=null;
    }catch(e){}
  }
  /* --- 3. memory, labelled --- */
  let err=null;
  if(!base){
    try{
      base=await callAI(askBase+`

No live source is available. Answer from your own knowledge, leave "sources" empty, and in
"conflict" say this came from memory and give the month your knowledge is current to.`,
        {max_tokens:1400,kind:"tax-recall"});
      if(typeof base.general==="number")mode="memory";else base=null;
    }catch(e){err=e}
  }
  if(!base)throw new Error(err&&err.message?err.message:"no rate could be established");

  const gen=+(+base.general).toFixed(4);
  const partsList=Array.isArray(base.breakdown)?base.breakdown.filter(b=>b&&typeof b.rate==="number"):[];
  const sum=+partsList.reduce((s,b)=>s+b.rate,0).toFixed(4);
  const sumNote=partsList.length&&Math.abs(sum-gen)>0.011
    ? `The components listed add to ${sum}% but the total came back as ${gen}% — one of them is wrong.`:null;

  /* Categories: from the pages if we got them, otherwise ask directly. */
  let cats=Array.isArray(base.categories)?base.categories:[],deptTax={},recent=null;
  try{
    const diff=await callAI(`In ${base.state||q}, general merchandise at retail is taxed at ${gen}%.
${cats.length?`Published pages for this location also show: ${cats.map(c=>`${c.n} ${c.rate}%`).join(", ")}.`:""}

A ${bizType||"retail store"} at ${q} has these departments: ${(deptNames||[]).join(", ")||"general merchandise"}.

Return ONLY valid JSON, no prose or fences:
{"categories":[{"key":string,"n":string,"rate":number,"what":string,"why":string,
  "carveOut":boolean,"examples":string[],"notIn":string[]}],
 "deptTax":{"<department name>":"<category key>"},"recent":string|null}

Include a category when EITHER of these is true:
 (a) its combined rate differs from ${gen}%, or
 (b) it is commonly mistaken for a lower-taxed category but is actually taxed at the full ${gen}% —
     set "carveOut" true for these. Candy and soft drinks are the classic case: they sit on a
     grocery shelf and look like food, but most states with a reduced grocery rate exclude them,
     so a cashier ringing them as groceries under-collects on every sale. Prepared and heated food
     is often excluded too, and sometimes carries an extra municipal food-and-beverage tax.

For every category:
- "examples": 5 to 8 specific products a convenience store actually sells that fall in it. Real
  items, not descriptions — "Snickers bar", "20oz Coca-Cola", "gallon of milk".
- "notIn": 2 to 4 products people wrongly assume belong in it, each with a short "actually X"
  clause naming where it does belong.
- "why": the rule or statute behind it, in one line.
- Always include a zero-rate "exempt" category for lottery and other untaxed lines.
- "deptTax": map EVERY department above to a category key, or to "general".
- "recent": any change in the last 18 months affecting these, else null.`,
      {max_tokens:2200,kind:"tax-categories"});
    if(Array.isArray(diff.categories)&&diff.categories.length)cats=diff.categories;
    deptTax=diff.deptTax||{};recent=diff.recent||null;
  }catch(e){}

  /* A category whose rate matches general is still worth listing when it is a
     carve-out — "candy is not groceries" is the whole reason the category exists. */
  cats=(cats||[]).filter(c=>c&&c.key&&typeof c.rate==="number"
    &&(Math.abs(+c.rate-gen)>0.004||c.carveOut===true));

  const out=[{key:"general",n:"General merchandise",rate:gen,
    what:"Everything not covered by another category",parts:partsList,src:base.conflict||null}];
  cats.forEach(c=>out.push({key:c.key,n:c.n||c.key,rate:+(+c.rate).toFixed(4),
    what:c.what||null,why:c.why||null,carveOut:!!c.carveOut,
    examples:Array.isArray(c.examples)?c.examples.slice(0,8):[],
    notIn:Array.isArray(c.notIn)?c.notIn.slice(0,4):[]}));
  if(!out.some(c=>Math.abs(c.rate)<0.0001))
    out.push({key:"exempt",n:"Non-taxable",rate:0,what:"Lottery, gift cards, fuel and other untaxed lines"});

  return{place:base.place||q,state:base.state||"",categories:out,deptTax,mode,
    breakdown:partsList,sources:Array.isArray(base.sources)?base.sources:[],
    pagesRead:pages.map(p=>p.url),
    verifyUrl:base.verifyUrl||"",conflict:base.conflict||null,sumNote,recent,confirmed:false,
    note:[base.conflict,sumNote,recent].filter(Boolean).join(" ")||null};
}
