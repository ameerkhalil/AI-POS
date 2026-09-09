/* =============================================================================
   AI POS v4
   Architecture borrows deliberately:
     Verifone Commander  — PLU / department / menu / MOP separation, restrictions,
                           mix-and-match, X and Z reads, safe drop, pay in/out
     Gilbarco Passport   — security groups, reason codes on exceptions,
                           blind balancing, scheduled cashier reminders
     Toast / Square      — modifier groups (required vs optional, priced options)
   The register is a thin client over one config object. Nothing is hardcoded
   that a store might reasonably need to change.
   ========================================================================== */

const $=id=>document.getElementById(id);
const money=n=>(Math.round(n*100)/100).toFixed(2);
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
/* For values going inside an inline handler's quoted argument. HTML escaping is
   not enough there — an apostrophe in "we'd like to start" ends the string and
   silently kills the button. */
const jsq=s=>String(s??"").replace(/\\/g,"\\\\").replace(/'/g,"\\'")
  .replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/\r?\n/g," ");
const uid=()=>Math.random().toString(36).slice(2,8);
const byId=(a,id)=>(a||[]).find(x=>x.id===id);
const hhmm=d=>d.toTimeString().slice(0,5);

const A={type:"",typeOther:"",name:"",desc:"",caps:[],loc:"",margin:"35",ending:"x9",dir:"nearest",
  priceMode:"margin",trade:{},mods:[],
  staff:[],layout:"",accent:"",mode:"dark",footer:"",policy:"",startCash:"200",
  logo:"",logoRaw:"",logoCut:false,logoTol:60,logoNote:"",slogan:"",
  keep:"keep",keepDays:"90",keepEmail:""};
let TRADE_Q=[],REC_MODS=[],TRADE_ASKED=false,FLEET=null,FLEET_ASKED=false;

/* What other stores of this trade already worked out. Structure only — the
   server will not hand over anything else. */
async function askFleet(){
  if(FLEET_ASKED||!A.type)return; FLEET_ASKED=true;
  try{
    const r=await api("/api/learn/suggest?type="+encodeURIComponent(A.type)
      +(typeof STORE_ID!=="undefined"&&STORE_ID?"&store="+STORE_ID:""));
    FLEET=r&&r.ready?r:null;
    if(FLEET){
      /* Pre-fill from consensus, but only where the owner hasn't answered. */
      if(!A.caps.length&&FLEET.caps?.length)A.caps=FLEET.caps.slice();
      if(!A.layout&&FLEET.layout?.v)A.layout=FLEET.layout.v;
      if(!A.mods.length&&FLEET.modules?.length)A.mods=FLEET.modules.map(m=>m.k);
      if(FLEET.priceMode?.v&&FLEET.priceMode.share>.6)A.priceMode=FLEET.priceMode.v;
      draw();
    }
  }catch(e){FLEET=null}
}
let TAXINFO=null;
const CAPS=[["age","Age-restricted products"],["weight","Items sold by weight"],
  ["foodservice","Prepared food with options"],["fuel","Fuel pumps"],["lottery","Lottery"],
  ["ebt","EBT / SNAP"],["deposit","Bottle deposit"]];
/* The business type steers the departments, the tax categories, which modules
   load and what the assistant suggests — so eight options meant eight different
   kinds of shop all being told they sell energy drinks. */
const TYPE_GROUPS=[
 ["Convenience & fuel",["Convenience store","Gas station","Truck stop","Bodega / corner shop","Kiosk"]],
 ["Grocery & food retail",["Grocery store","Supermarket","International market","Health food store",
   "Butcher","Fishmonger","Produce market","Farm stand","Cheese shop"]],
 ["Food & drink service",["Café","Coffee shop","Bakery","Deli / sandwich shop","Restaurant",
   "Fast food","Pizzeria","Food truck","Juice / smoothie bar","Ice cream shop","Bar / pub","Brewery / taproom"]],
 ["Alcohol, tobacco & vape",["Liquor store","Wine shop","Beer store","Tobacco shop","Vape shop",
   "Smoke shop","Dispensary"]],
 ["Clothing & accessories",["Clothing store","Boutique","Shoe store","Streetwear shop",
   "Children's clothing","Jewelry store","Watch shop","Handbags & accessories","Thrift / consignment"]],
 ["Health & beauty",["Pharmacy","Beauty supply","Cosmetics shop","Vitamin & supplement store",
   "Salon","Barbershop","Nail salon","Spa"]],
 ["Home, garden & trade",["Hardware store","Paint store","Garden centre","Nursery","Furniture store",
   "Home goods","Lighting store","Flooring / tile"]],
 ["Speciality retail",["Bookstore","Toy store","Game store","Comic shop","Record shop",
   "Musical instruments","Craft & hobby","Fabric & yarn","Stationery / office supplies",
   "Party supplies","Gift shop","Florist","Antiques"]],
 ["Sport, outdoor & auto",["Sporting goods","Bike shop","Outdoor & camping","Fishing & tackle",
   "Gun shop","Auto parts","Tire shop","Car wash","Motorcycle / powersports"]],
 ["Electronics & phones",["Electronics store","Phone & accessories","Computer shop","Repair shop",
   "Camera store"]],
 ["Pets & animals",["Pet store","Pet grooming","Feed & farm supply","Aquarium shop"]],
 ["Something else",["Other retail","Other food service","Other service business"]]
];
const TYPES=TYPE_GROUPS.flatMap(g=>g[1]);

/* How the counter actually works differs more between trades than the product
   list does. A grocery scans and needs the search bar leading; a café taps and
   needs six big keys. Same code, different shape. */
/* An interface style changes how the register is DRAWN, not just how big things
   are. Keys render as tiles, rows, cards or pads. Navigation is a rail or a top
   bar. The receipt is a till roll, a plain list, or a summary. A pizza shop and
   a grocery should not be the same screen with different words on it. */
/* Eight registers, each designed as a whole rather than assembled from sliders.
   Different type, different palette, different arrangement, different weight.
   Every one has been drawn deliberately and works — which is worth more than
   the freedom to build something that doesn't. */
/* Five registers. Not one design in five colourways — five different machines
   that happen to share a database. Different shell, different interaction,
   different typeface, different palette. Somebody shown two of these would not
   guess they were the same software. */
/* Five registers, each built to the conventions of a different corner of the
   market. A cashier who has used one of these before should recognise the
   shape of it immediately — that familiarity is the point.

   Named for what they are rather than who they resemble. */
const LAYOUTS=[
 {k:"commander",n:"Commander",tag:"Fuel, convenience, liquor — the industry standard",
  shell:"classic",font:"Archivo",mono:"Azeret Mono",mode:"dark",accent:"#3D8BD6",
  bg:"#2B3033",panel:"#373D41",line:"#4A5155",key:"#454C50",radius:2,chrome:"own",
  ref:"Steel grey, hard edges, dense function keys and a blue line display. The shape every forecourt and convenience counter in America already runs.",
  why:"A keypad and department keys with no product grid. Sharp corners, small type, everything reachable without scrolling."},

 {k:"service",n:"Service",tag:"Restaurants, cafés, bars — table and counter service",
  shell:"menu",font:"Space Grotesk",mono:"Space Mono",mode:"dark",accent:"#FF4C00",
  bg:"#1A1A1A",panel:"#242424",line:"#333333",key:"#2E2E2E",radius:8,chrome:"own",
  ref:"Near-black with a hot orange, heavy type, full-bleed tiles and an order that reads back before payment.",
  why:"Built for a hot line and a queue. Options open as a full screen, the order is confirmed once, and the ticket number fills the display at the end."},

 {k:"board",n:"Board",tag:"Delis, takeaways, repair counters — several orders at once",
  shell:"board",font:"Inter",mono:"Inter",mode:"dark",accent:"#4FA3D9",
  bg:"#1E2429",panel:"#262E34",line:"#39434B",key:"#2E3740",radius:6,chrome:"own",
  ref:"Every open order visible at the same time as a card, with products adding to whichever one is active.",
  why:"No other register here can hold four orders at once. Tap a ticket to make it live, tap products to fill it, settle it when they pay. Built for a counter where three people are waiting on different things."},

 {k:"commerce",n:"Commerce",tag:"Clothing, gifts, anything with a catalogue behind it",
  shell:"commerce",font:"Inter",mono:"Inter",mode:"light",accent:"#008060",
  bg:"#F1F2F4",panel:"#FFFFFF",line:"#DFE3E8",key:"#FFFFFF",radius:8,chrome:"own",
  ref:"Search-led, products as a list rather than a grid, a green checkout button and a cart panel that behaves like an online one.",
  why:"For a shop with more products than fit on a screen. You search or scan rather than browse, and the cart totals like a web checkout."},

 {k:"kiosk",n:"Kiosk",tag:"Big screens, queues, anywhere a customer can see it",
  shell:"kiosk",font:"Inter",mono:"Inter",mode:"light",accent:"#00A05A",
  bg:"#FFFFFF",panel:"#F5F7F6",line:"#E1E6E3",key:"#F5F7F6",radius:16,chrome:"own",
  ref:"One thing on screen at a time — categories, then products, then how many. Nothing sits beside anything else.",
  why:"Every other register shows a grid and an order together. This one never does: it asks one question per screen with targets big enough to hit from a metre away."}
];
const ACCENTS=[
 ["#5CE0A8","Mint"],["#3FBF8F","Jade"],["#2FA3A3","Teal"],["#4FD6D6","Aqua"],
 ["#6BA8D8","Sky"],["#4A7FD4","Cobalt"],["#6C6CE0","Indigo"],["#9B7BE8","Violet"],
 ["#C77BE0","Orchid"],["#E08AB0","Rose"],["#E56B6B","Coral"],["#D2664C","Rust"],
 ["#E08A3C","Amber"],["#E0B255","Honey"],["#C9C24A","Citron"],["#8FCF4A","Lime"],
 ["#5FB84A","Fern"],["#3E8E5A","Forest"],["#8A7A66","Clay"],["#9AA3A7","Steel"],
 ["#D9CFC0","Bone"],["#B0453C","Brick"],["#7A3F6D","Plum"],["#2B5F8A","Denim"]
];
function suggestLayout(){
  const t=(A.type+" "+A.desc).toLowerCase();
  if(/restaurant|pizz|bar|pub|brewery|taproom|caf|coffee/.test(t))return "service";
  if(/deli|sandwich|takeaway|butcher|repair|phone|tailor|dry clean/.test(t))return "board";
  if(/cloth|boutique|shoe|jewel|watch|handbag|furniture|gift|book|record|toy|craft/.test(t))return "commerce";
  if(/convenience|gas|fuel|truck stop|liquor|tobacco|vape|hardware|auto parts|pharmac/.test(t))return "commander";
  if(/bakery|juice|ice cream|food truck|market stall|kiosk|stand/.test(t))return "kiosk";
  return "commerce";
}
function suggestAccent(){
  const t=(A.type+" "+A.desc).toLowerCase();
  if(/caf|coffee|bakery|butcher|deli/.test(t))return "#E0B255";
  if(/cloth|boutique|jewel|salon|spa|nail/.test(t))return "#B78BE0";
  if(/phone|electronic|computer|camera/.test(t))return "#6BA8D8";
  if(/liquor|wine|bar|pub|brewery/.test(t))return "#D2664C";
  return "#5CE0A8";
}
window.__acc=hex=>{A.accent=hex;draw()};
window.__lay=k=>{A.layout=k;draw()};
/* Background removal.

   Most logos arrive as a mark on a solid white square, which looks like a
   sticker on a dark launch plate. This floods inward from the edges, clearing
   anything close to the corner colour, and stops at the artwork. Flooding from
   the edges rather than matching every white pixel is what keeps the white
   inside an O, or the highlight on a bottle, intact. */
function removeBg(src, tol, cb){
  const img=new Image();
  img.onload=()=>{
    const w=img.width,h=img.height;
    const c=document.createElement("canvas");
    c.width=w;c.height=h;
    const cx=c.getContext("2d",{willReadFrequently:true});
    cx.drawImage(img,0,0);
    const d=cx.getImageData(0,0,w,h),px=d.data;

    /* A PNG that already has a transparent background reads (0,0,0,0) at the
       corners. Treating that as "the background is black" is what made this
       tool eat dark logos. If the corners are already clear there is nothing
       to remove, so leave the artwork alone. */
    const corners=[0,(w-1)*4,(h-1)*w*4,((h-1)*w+(w-1))*4];
    const opaque=corners.filter(i=>px[i+3]>200);
    if(!opaque.length)return cb(src,{already:true});

    const bg=[0,1,2].map(k=>Math.round(opaque.reduce((s,i)=>s+px[i+k],0)/opaque.length));
    const near=i=>{
      if(px[i+3]<24)return true;                  // already clear, keep flooding
      const dr=px[i]-bg[0],dg=px[i+1]-bg[1],db=px[i+2]-bg[2];
      return Math.sqrt(dr*dr+dg*dg+db*db)<=tol;
    };

    const seen=new Uint8Array(w*h),stack=[];
    for(let x=0;x<w;x++)stack.push(x,(h-1)*w+x);
    for(let y=0;y<h;y++)stack.push(y*w,y*w+w-1);
    let cleared=0;
    while(stack.length){
      const p=stack.pop();
      if(seen[p])continue;
      seen[p]=1;
      const i=p*4;
      if(!near(i))continue;
      if(px[i+3])cleared++;
      px[i+3]=0;
      const x=p%w,y=(p/w)|0;
      if(x>0)stack.push(p-1);
      if(x<w-1)stack.push(p+1);
      if(y>0)stack.push(p-w);
      if(y<h-1)stack.push(p+w);
    }

    /* If nearly everything went, the guess was wrong — hand back the original
       rather than a hole where a logo used to be. */
    if(cleared>w*h*0.94)return cb(src,{tooMuch:true});

    const out=new Uint8ClampedArray(px);
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
      const p=y*w+x,i=p*4;
      if(px[i+3]===0)continue;
      let clear=0;
      if(px[(p-1)*4+3]===0)clear++;
      if(px[(p+1)*4+3]===0)clear++;
      if(px[(p-w)*4+3]===0)clear++;
      if(px[(p+w)*4+3]===0)clear++;
      if(clear)out[i+3]=Math.round(px[i+3]*(1-clear*0.18));
    }
    cx.putImageData(new ImageData(out,w,h),0,0);
    cb(c.toDataURL("image/png"),{cleared:Math.round(cleared/(w*h)*100)});
  };
  img.onerror=()=>cb(src,{failed:true});
  img.src=src;
}

/* Scaled down before it's stored — a 4MB phone photo has no business being in
   a config object that gets written on every keystroke. */
window.__cut=on=>{
  if(!on){A.logoCut=false;A.logo=A.logoRaw||A.logo;A.logoNote="";return draw()}
  A.logoCut=true;
  removeBg(A.logoRaw||A.logo,A.logoTol,(d,info)=>{
    A.logo=d;
    A.logoNote=info.already?"This logo already has a transparent background — nothing to remove."
      :info.tooMuch?"That would have removed almost the whole image, so it was left alone. This works on a flat background behind the mark."
      :info.failed?"Couldn't read that image."
      :`Cleared ${info.cleared}% of the image.`;
    if(info.already||info.tooMuch)A.logoCut=false;
    draw();
  });
};
window.__tol=v=>{
  A.logoTol=parseInt(v)||60;
  removeBg(A.logoRaw||A.logo,A.logoTol,(d,info)=>{A.logo=d;
    A.logoNote=info.cleared!=null?`Cleared ${info.cleared}% of the image.`:(A.logoNote||"");
    const el=document.querySelector(".lp.on .lpimg img");if(el)el.src=d;
    const out=document.querySelector(".logotools .strange b");if(out)out.textContent=A.logoTol;});
};
function takeLogo(file){
  if(!/^image\//.test(file.type))return;
  const img=new Image(),url=URL.createObjectURL(file);
  img.onload=()=>{
    URL.revokeObjectURL(url);
    const max=320,s=Math.min(1,max/Math.max(img.width,img.height));
    const c=document.createElement("canvas");
    c.width=Math.round(img.width*s);c.height=Math.round(img.height*s);
    const cx=c.getContext("2d");
    cx.imageSmoothingQuality="high";
    cx.drawImage(img,0,0,c.width,c.height);
    A.logoRaw=c.toDataURL("image/png");
    A.logo=A.logoRaw;
    A.logoCut=false;
    draw();
  };
  img.onerror=()=>URL.revokeObjectURL(url);
  img.src=url;
}
const PALETTE=["#3E464A","#3A5A52","#57493B","#3D4D66","#573D4D","#485435","#4A3F5C","#2F4F55"];
const PERMS=[["void","Void a line or sale"],["discount","Apply a discount"],["refund","Process a return"],
  ["payout","Pay in and pay out"],["nosale","Open the drawer with no sale"],["pricechange","Override a price"],
  ["reports","Read reports"],["zreport","Close the shift"],["config","Change configuration"]];

let CFG=null,CART=[],MENU=0,SEL=null,DISC=null,RETURN=false,HELD=[],FILTER="",TRAIN=false;
let ME=null,VIEW="sale",FRESH=null,RETREF=null,SALE_TIP=0,SALE_CUST=null,PART_PAID=null;
let SHIFT={opened:new Date(),sales:[],startCash:200,paidIn:0,paidOut:0,safeDrops:0,noSales:0,num:1,exceptions:[]};

/* ========================= wizard ========================= */
let STEP=0;
const STEPS=[
 {q:"What kind of business is this?",s:"This decides the departments, which tax categories apply, and which parts of the register load at all. Pick the closest — everything stays editable.",
  render:()=>`<div class="field">
      <select id="f0" class="bigsel">
        <option value="">Choose a business type\u2026</option>
        ${TYPE_GROUPS.map(([g,list])=>`<optgroup label="${esc(g)}">${
          list.map(t=>`<option ${A.type===t?"selected":""}>${esc(t)}</option>`).join("")}</optgroup>`).join("")}
      </select></div>
    <div class="field" id="otherWrap" style="display:${/^Other /.test(A.type)?"block":"none"}">
      <input type="text" id="f0b" placeholder="Describe it in a few words" value="${esc(A.typeOther||"")}">
    </div>
    <div class="hint">Can't see yours? Pick the nearest — what you write on the next screens is what
      the pricebook is actually built from.</div>`,
  bind(){
    const sel=$("f0"),other=$("otherWrap");
    sel.onchange=e=>{
      A.type=e.target.value;
      other.style.display=/^Other /.test(A.type)?"block":"none";
      $("goBtn").disabled=!A.type;
      if(other.style.display==="block"&&$("f0b"))$("f0b").focus();
    };
    if($("f0b"))$("f0b").oninput=e=>{A.typeOther=e.target.value};
    sel.focus();
  },
  ok:()=>!!A.type},
 {q:"What's the store called?",s:"This prints at the top of every receipt and shows in the terminal header.",
  render:()=>`<div class="field"><input type="text" id="f1" placeholder="Palos Hills Food and Fuel" value="${esc(A.name)}"></div>`,
  bind(){$("f1").oninput=e=>{A.name=e.target.value;$("goBtn").disabled=!A.name.trim()};$("f1").focus()},ok:()=>!!A.name.trim()},
 {q:"Where is the store?",s:"City and state, or a ZIP code. I'll look up the sales tax that actually applies at that address rather than making you find it.",
  render:()=>`<div class="field"><input type="text" id="f5" placeholder="Palos Hills, Illinois" value="${esc(A.loc)}"></div>
    <div class="hint">State, county and any city or district rate get set up as separate rates, so you can see what makes up the total.</div>`,
  bind(){$("f5").oninput=e=>{A.loc=e.target.value;$("goBtn").disabled=A.loc.trim().length<3};$("f5").focus()},
  ok:()=>A.loc.trim().length>=3},
 {q:"What do you actually sell?",s:"Describe it the way you'd explain it to a new hire. Specifics here are what make the first pricebook close to right.",
  render:()=>`<div class="field"><textarea id="f2" placeholder="Cigarettes and vapes, fountain drinks and coffee, chips and candy, energy drinks, beer, roller grill hot food, phone chargers, lottery.">${esc(A.desc)}</textarea></div><div class="hint">Name real brands and price points if you have them.</div>`,
  bind(){$("f2").oninput=e=>{A.desc=e.target.value;$("goBtn").disabled=e.target.value.trim().length<12};$("f2").focus()},
  ok:()=>A.desc.trim().length>=12},
 {q:"Which of these apply to you?",s:"Each one turns on a module. What you leave off never loads and never reaches the cashier's screen.",
  render:()=>fleetNote("caps")
    +chipMulti(CAPS,A.caps,k=>{const i=A.caps.indexOf(k);i<0?A.caps.push(k):A.caps.splice(i,1)}),ok:()=>true},
 {q:"How do you price?",s:"If you mark up from cost, tell me the margin and invoice costs turn into shelf prices on their own. Plenty of trades don't price that way — a coffee that costs 40 cents doesn't sell for 80.",
  render:()=>`${chipList2([["margin","I mark up from cost"],["value","I price by what it's worth"]],
      A.priceMode||"margin",v=>{A.priceMode=v;draw()})}
    ${A.priceMode!=="value"?`<div class="taxrow" style="margin-top:26px">
      <div><label for="f4">Target gross margin</label><input type="text" id="f4" class="num" placeholder="35" value="${esc(A.margin)}"></div>
      <div style="align-self:flex-end;color:var(--ink-soft);font-size:14px;padding-bottom:14px">
        a $2.00 cost becomes <b id="egp">${money(charmPreview())}</b></div></div>`
      :`<div class="hint" style="margin-top:22px">Prices stay however you set them. Costs are still
        recorded from invoices, and margin is still reported — nothing gets repriced behind your back.</div>`}
    <div class="hint" style="margin-top:22px">Round prices to</div>
    ${chipList2([["x9","End in 9 cents"],["99","Always .99"],["95","Always .95"],["49-99",".49 or .99"],["none","Don't round"]],A.ending,v=>{A.ending=v;draw()})}`,
  bind(){
    const f=$("f4");
    if(f)f.oninput=e=>{A.margin=e.target.value;
      $("goBtn").disabled=isNaN(parseFloat(A.margin))||parseFloat(A.margin)<0||parseFloat(A.margin)>94;
      $("egp").textContent=money(charmPreview())};
  },
  ok:()=>{if(A.priceMode==="value")return true;
    const m=parseFloat(A.margin);return !isNaN(m)&&m>=0&&m<=94}},

 {q:"Who works the register?",s:"Everyone gets their own code, so every sale, void and drawer open is stamped with who did it. You can add more later — this is just to open with.",
  render:()=>`<div class="stafflist" id="staffList">${(A.staff.length?A.staff:[{n:"",role:"Manager",pin:""}])
      .map((s,i)=>`<div class="staffrow">
        <input class="sn" placeholder="Name" value="${esc(s.n)}" data-i="${i}" data-f="n">
        <select class="sr" data-i="${i}" data-f="role">
          ${["Manager","Shift lead","Cashier"].map(r=>
            `<option ${s.role===r?"selected":""}>${r}</option>`).join("")}
        </select>
        <input class="sp num" placeholder="PIN" maxlength="4" inputmode="numeric"
          value="${esc(s.pin)}" data-i="${i}" data-f="pin">
        ${A.staff.length>1?`<button class="sx" data-del="${i}">\u00d7</button>`:`<span class="sx"></span>`}
      </div>`).join("")}</div>
    <button class="addstaff" id="addStaff">+ Add someone</button>
    <div class="hint">A manager can do everything. A shift lead can void and discount. A cashier can't
      do either without someone approving it — which is the point of the codes.</div>`,
  bind(){
    if(!A.staff.length)A.staff=[{n:"",role:"Manager",pin:""}];
    const wrap=$("staffList");
    wrap.querySelectorAll("input,select").forEach(el=>{
      const set=e=>{
        const i=+el.dataset.i,f=el.dataset.f;
        A.staff[i][f]=f==="pin"?e.target.value.replace(/\D/g,"").slice(0,4):e.target.value;
        if(f==="pin")el.value=A.staff[i].pin;
        softUpdate();
      };
      el.oninput=set;el.onchange=set;
    });
    wrap.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>{
      A.staff.splice(+b.dataset.del,1);draw()});
    $("addStaff").onclick=()=>{A.staff.push({n:"",role:"Cashier",pin:""});draw()};
    const first=wrap.querySelector("input");if(first&&!first.value)first.focus();
  },
  ok:()=>A.staff.length&&A.staff.every(s=>s.n.trim()&&/^\d{4}$/.test(s.pin))
    &&new Set(A.staff.map(s=>s.pin)).size===A.staff.length},

 {q:"How long should your records be kept?",s:"Sales and shift history live on the server so your reports work. Some owners would rather that history didn't sit there indefinitely — this is where you say so.",
  render:()=>`${chipList2([["keep","Keep everything"],["wipe","Delete it after a while"]],
      A.keep,v=>{A.keep=v;draw()})}
    ${A.keep==="wipe"?`
      <div class="hint" style="margin-top:26px">Delete anything older than</div>
      ${chipList2([["7","A week"],["30","A month"],["90","Three months"],
        ["365","A year"],["custom","Something else"]],
        ["7","30","90","365"].includes(A.keepDays)?A.keepDays:"custom",
        v=>{A.keepDays=v==="custom"?"14":v;draw()})}
      ${!["7","30","90","365"].includes(A.keepDays)?`<div class="taxrow">
        <div><label for="f10">Days to keep</label>
        <input type="text" id="f10" class="num" value="${esc(A.keepDays)}"></div></div>`:""}
      <div class="field" style="margin-top:26px">
        <input type="text" id="f11" placeholder="Email it to me first (optional)"
          value="${esc(A.keepEmail)}">
      </div>
      <div class="keepwhat">
        <div class="kw go"><b>Deleted</b><span>Sales, shift history, card payment references</span></div>
        <div class="kw no"><b>Never touched</b><span>Your pricebook, departments, tax rates, staff,
          layout — the register keeps working exactly as it does now</span></div>
      </div>
      <div class="hint" style="margin-top:18px">A copy is always written before anything is removed,
        and if that copy can't be made the deletion doesn't happen. You can change or stop this at any
        time under Store &amp; tax.</div>`
    :`<div class="hint" style="margin-top:24px">Everything is kept and backed up, so your reports go
      back as far as you've been trading. You can switch to a shorter window whenever you like.</div>`}`,
  bind(){
    if($("f10"))$("f10").oninput=e=>{A.keepDays=e.target.value.replace(/\D/g,"").slice(0,4)};
    if($("f11"))$("f11").oninput=e=>{A.keepEmail=e.target.value};
  },
  ok:()=>A.keep!=="wipe"||(parseInt(A.keepDays)>0)},

 {q:"Your logo and your line",s:"Both show on the screen when the register opens, on the receipt, and in the corner of the terminal all day. Skip either if you'd rather.",
  render:()=>`<div class="logodrop ${A.logo?"has":""}" id="logoDrop">
      ${A.logo?`<img src="${A.logo}" alt="">`
        :`<svg viewBox="0 0 24 24"><path d="M12 16V4m0 0L8 8m4-4 4 4"/>
           <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>`}
      <div class="logotext">
        <b>${A.logo?"Looking good":"Drop your logo here"}</b>
        <span>${A.logo?"Click to replace it, or remove it below."
          :"PNG or JPEG. A square or wide mark works best — it gets scaled, never stretched."}</span>
      </div>
      <input type="file" id="logoFile" accept="image/*" hidden>
    </div>
    ${A.logo?`<div class="logotools">
      <div class="logopreviews big">
        <div class="lp ${A.logoCut?"":"on"}" onclick="__cut(false)">
          <span class="lpimg plain"><img src="${A.logoRaw||A.logo}" alt=""></span>
          <em>As uploaded</em></div>
        <div class="lp ${A.logoCut?"on":""}" onclick="__cut(true)">
          <span class="lpimg checker"><img src="${A.logoCut?A.logo:(A.logoRaw||A.logo)}" alt=""></span>
          <em>Background removed</em></div>
      </div>
      ${A.logoNote?`<div class="lognote">${esc(A.logoNote)}</div>`:""}
      ${A.logoCut?`<label class="strange" style="margin-top:12px">
        <span>How much</span>
        <input type="range" min="20" max="140" value="${A.logoTol}"
          oninput="__tol(this.value)"><b>${A.logoTol}</b></label>
        <div class="hint" style="margin-top:6px">Nudge this if too much or too little came away.
          It only clears colour connected to the edges, so white inside the artwork stays.</div>`:""}
      <button class="logoclear" id="logoClear">Remove the logo entirely</button>
    </div>`:""}
    <div class="field" style="margin-top:26px">
      <input type="text" id="f9" placeholder="Your slogan, or what you're known for" value="${esc(A.slogan)}">
    </div>
    <div class="hint">Something short. "Open since 1994", "The best coffee on 103rd", or nothing at all.</div>`,
  bind(){
    const drop=$("logoDrop"),file=$("logoFile");
    drop.onclick=()=>file.click();
    file.onchange=e=>{const f=e.target.files[0];if(f)takeLogo(f)};
    ["dragenter","dragover"].forEach(n=>drop.addEventListener(n,e=>{e.preventDefault();
      drop.classList.add("over")}));
    ["dragleave","drop"].forEach(n=>drop.addEventListener(n,e=>{e.preventDefault();
      drop.classList.remove("over")}));
    drop.addEventListener("drop",e=>{const f=e.dataTransfer.files[0];if(f)takeLogo(f)});
    if($("logoClear"))$("logoClear").onclick=e=>{e.stopPropagation();
      A.logo="";A.logoRaw="";A.logoCut=false;draw()};
    $("f9").oninput=e=>{A.slogan=e.target.value;softUpdate()};
  },
  ok:()=>true},

 {q:"What goes on the receipt?",s:"Printed at the bottom of every one. Most shops put their return policy here, because it's the only place a customer will ever read it.",
  render:()=>`<div class="field"><input type="text" id="f6" placeholder="Thanks for shopping with us"
      value="${esc(A.footer)}"></div>
    <div class="field"><input type="text" id="f7" placeholder="Returns within 30 days with a receipt"
      value="${esc(A.policy)}"></div>
    <div class="taxrow"><div><label for="f8">Opening cash in the drawer</label>
      <input type="text" id="f8" class="num" value="${esc(A.startCash)}"></div></div>
    <div class="hint">Both are optional and editable later under Site &amp; tax.</div>`,
  bind(){
    $("f6").oninput=e=>{A.footer=e.target.value;softUpdate()};
    $("f7").oninput=e=>{A.policy=e.target.value;softUpdate()};
    $("f8").oninput=e=>{A.startCash=e.target.value.replace(/[^0-9.]/g,"")};
    $("f6").focus();
  },
  ok:()=>true},

 /* The last question isn't written by me — it's written for this trade. A
    butcher and a phone shop need different things and shouldn't be asked the
    same script. */
 {q:"A few things about your trade",s:"These came from what you told me. They decide which parts of the register get built.",
  render:()=>TRADE_Q.length
    ? TRADE_Q.map((q,i)=>`<div class="tradeq">
        <div class="tqq">${esc(q.q)}</div>
        ${chipList3(i,q.opts||["Yes","No"],A.trade[i])}
        ${q.why?`<div class="tqw">${esc(q.why)}</div>`:""}</div>`).join("")
      +(REC_MODS.length?`<div class="tradeq">
        <div class="tqq">Parts of the register I'd switch on for you</div>
        ${REC_MODS.map(id=>`<label class="modpick ${A.mods.includes(id)?"on":""}">
          <input type="checkbox" ${A.mods.includes(id)?"checked":""} onchange="__modtog('${id}',this)">
          <span><b>${esc(MODULES[id].n)}</b><em>${esc(MODULES[id].what)}</em></span></label>`).join("")}
        </div>`:"")
    : `<div class="hint">Working out what to ask you…</div>`,
  ok:()=>TRADE_Q.length===0||TRADE_Q.every((_,i)=>A.trade[i]!==undefined)}
];
/* Says what the fleet did, in numbers, without pretending it's a rule. */
function fleetNote(kind){
  if(!FLEET||!FLEET.ready)return "";
  const n=FLEET.contributors;
  let body="";
  if(kind==="caps"&&FLEET.caps?.length){
    const labels=FLEET.caps.map(c=>(CAPS.find(x=>x[0]===c)||[,c])[1]);
    body=`Most ${esc(A.type.toLowerCase())}s turn on ${esc(labels.join(", "))}. Already ticked below —
      untick anything that isn't you.`;
  } else if(kind==="layout"&&FLEET.layout?.v){
    const L=LAYOUTS.find(x=>x.k===FLEET.layout.v);
    body=`${Math.round(FLEET.layout.share*100)}% of them run <b>${esc(L?L.n:FLEET.layout.v)}</b>.`;
  } else if(kind==="depts"&&FLEET.depts?.length){
    body=`They usually run ${esc(FLEET.depts.slice(0,6).map(d=>d.n).join(", "))}.`;
  }
  if(!body)return "";
  return `<div class="fleetnote">
    <svg viewBox="0 0 24 24"><path d="M3 12h4l3-8 4 16 3-8h4" stroke="currentColor" stroke-width="1.7"
      fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <div><b>From ${n} other ${esc(A.type.toLowerCase())}${n===1?"":"s"} already running</b>
      <span>${body}</span></div></div>`;
}

function chipList3(qi,opts,cur){
  window.__tq=(i,v,btn)=>{
    A.trade[i]=v;
    if(btn){const wrap=btn.parentElement;
      if(wrap)[...wrap.children].forEach(b=>b.classList.toggle("on",b===btn))}
    softUpdate();
  };
  return`<div class="chips" style="margin-top:10px">`+opts.map(o=>
    `<button class="chip ${cur===o?"on":""}" onclick="__tq(${qi},'${jsq(o)}',this)">
      <span class="tick">\u2713</span>${esc(o)}</button>`).join("")+`</div>`;
}
window.__modtog=(id,el)=>{
  const i=A.mods.indexOf(id);i<0?A.mods.push(id):A.mods.splice(i,1);
  const row=el&&el.closest(".modpick"); if(row)row.classList.toggle("on");
  softUpdate();
};

/* Each group gets its own handler. One shared global meant a second group on the
   same screen silently stole the first one's clicks. */
let CHIP_N=0;
const CHIP_CB={};
window.__chip=(id,v,btn)=>CHIP_CB[id]&&CHIP_CB[id](v,btn);
function chipList2(pairs,cur,cb){
  const id="c"+(++CHIP_N);
  CHIP_CB[id]=cb;
  return`<div class="chips" style="margin-top:12px">`+pairs.map(([k,l])=>
    `<button class="chip ${cur===k?"on":""}" onclick="__chip('${id}','${k}')"><span class="tick">\u2713</span>${l}</button>`).join("")+`</div>`;
}

function charmPreview(){
  const m=Math.min(94,Math.max(0,parseFloat(A.margin)||0))/100;
  const raw=m>=1?2:2/(1-m);
  return charm(raw,A.ending,A.dir);
}
function chipList(a,c,cb){
  const id="c"+(++CHIP_N);CHIP_CB[id]=cb;
  return`<div class="chips">`+a.map(v=>
    `<button class="chip ${c===v?"on":""}" onclick="__chip('${id}','${jsq(v)}')"><span class="tick">✓</span>${esc(v)}</button>`).join("")+`</div>`}
/* Multi-select updates the one chip that was clicked rather than re-rendering
   the step. Redrawing replayed every chip's entrance animation, so picking six
   things made the whole screen jump six times. */
function chipMulti(p,on,cb){
  const id="c"+(++CHIP_N);
  CHIP_CB[id]=(v,btn)=>{cb(v);if(btn)btn.classList.toggle("on");softUpdate()};
  return`<div class="chips">`+p.map(([k,l])=>
    `<button class="chip ${on.includes(k)?"on":""}" onclick="__chip('${id}','${k}',this)"><span class="tick">✓</span>${esc(l)}</button>`).join("")+`</div>`}

/* Everything a chip toggle needs to refresh, without touching the markup the
   user is looking at. */
function softUpdate(){
  const st=STEPS[STEP];
  const g=$("goBtn"); if(g)g.disabled=!st.ok();
  try{drawSide()}catch(e){}
}
function draw(){
  /* Repair anything an earlier version wrote into the wrong field. */
  if(!["x9","99","95","49-99","none"].includes(A.ending))A.ending="x9";
  if(!["margin","value"].includes(A.priceMode))A.priceMode="margin";
  const st=STEPS[STEP];
  $("setupBody").innerHTML=`
    <div class="steprail">${STEPS.map((s,i)=>
      `<span class="sd ${i<STEP?"done":i===STEP?"now":""}" title="${esc(s.q)}">${
        i<STEP?"\u2713":i+1}</span>`).join("")}</div>
    <div class="qhead">
      <div class="qnum">Question ${STEP+1} of ${STEPS.length}</div>
      <h1>${st.q}</h1>
      <p class="sub">${st.s}</p>
    </div>
    <div class="qbody">${st.render()}</div>
    <div class="nav">
      <button class="go" id="goBtn" ${st.ok()?"":"disabled"}>
        ${STEP===STEPS.length-1?"Build my terminal":"Continue"}
        <svg viewBox="0 0 16 16"><path d="M2 8h11M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.8"
          fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      ${STEP>0?`<button class="back" id="backBtn">Back</button>`:""}
    </div>`;
  st.bind&&st.bind();
  $("goBtn").onclick=()=>{
    if(STEP===STEPS.length-1)return build();
    STEP++;
    /* The trade questions are written for this business, so they can't exist
       until the earlier answers do. */
    /* Asked as soon as we know the trade, so the answers are ready by the time
       the step is reached rather than the owner waiting on a spinner. */
    if(A.type&&!FLEET_ASKED)askFleet();
    if(A.desc.trim().length>=12&&!TRADE_ASKED){TRADE_ASKED=true;askTrade()}
    draw();
  };
  $("backBtn")&&($("backBtn").onclick=()=>{STEP--;draw()});
  /* Decoration last, and defensively — a broken preview must never take the
     buttons down with it. */
  try{drawSide()}catch(e){}
}

/* The right-hand panel assembles their terminal as they answer. It's the
   difference between filling in a form and watching something get built. */
function drawSide(){
  const el=$("setupSide"); if(!el)return;
  /* On the layout step the panel stops summarising and starts showing. Reading
     "compact keys, search leads" is not the same as seeing it. */
  const wide=STEPS[STEP]&&/register look|the colours/i.test(STEPS[STEP].q);
  const grid=document.querySelector(".setup-grid");
  if(grid)grid.classList.toggle("wide",!!wide);
  if(wide)return drawLayoutPreview(el);
  const filled=[
    A.type&&{k:"Business",v:A.typeOther||A.type},
    A.name&&{k:"Store",v:A.name},
    A.loc&&{k:"Where",v:A.loc},
    A.caps.length&&{k:"Modules",v:A.caps.length+" on"},
    A.priceMode==="value"?{k:"Pricing",v:"By value"}
      :(A.margin&&{k:"Margin",v:A.margin+"%"})
  ].filter(Boolean);

  el.innerHTML=`
    <div class="sidecard">
      <div class="sidetop">
        ${A.logo?`<img class="sidelogo" src="${A.logo}" alt="">`:`<span class="dot"></span>`}
        <b>${esc(A.name||"Your store")}</b>
        <em>Register 1</em>
      </div>
      <div class="sidebody">
        ${filled.length?filled.map((f,i)=>`<div class="sideline" style="animation-delay:${i*60}ms">
          <span>${esc(f.k)}</span><b>${esc(f.v)}</b></div>`).join("")
          :`<div class="sidewait">Answer on the left and this fills in.</div>`}
        ${A.caps.length?`<div class="sidechips">${A.caps.map(c=>{
          const l=(CAPS.find(x=>x[0]===c)||[,c])[1];
          return `<span>${esc(l)}</span>`}).join("")}</div>`:""}
        ${A.mods&&A.mods.length?`<div class="sidechips mods">${A.mods.map(m=>
          `<span>${esc((typeof MODULES!=="undefined"&&MODULES[m]?.n)||m)}</span>`).join("")}</div>`:""}
      </div>
      <div class="sidefoot">
        <span>Total</span>
        <b class="num">${A.priceMode==="value"?"\u2014":money(charmPreview())}</b>
      </div>
    </div>
    <div class="sidenote">Nothing here is fixed. Every part of it is editable once the
      terminal opens, and the wizard never has to be run twice.</div>`;
}

/* A working miniature of the register in the chosen arrangement. Same pieces as
   the real thing — receipt, department strip, key grid, function row — just
   small, so the difference between the five layouts is visible rather than
   described. */
function drawLayoutPreview(el){
  const L=LAYOUTS.find(x=>x.k===(A.layout||suggestLayout()))||LAYOUTS[0];
  const accent=A.accent||suggestAccent();
  const mode=A.mode||"dark";
  const S=mode==="light"
    ? {bg:"#EDEEEA",panel:"#F7F7F4",line:"#D2D5CF",txt:"#14181A",dim:"#6C7679",key:"#E2E4DE",keyTxt:"#14181A"}
    : mode==="contrast"
    ? {bg:"#000",panel:"#0C0E0F",line:"#4E585C",txt:"#fff",dim:"#AEB6B9",key:"#1C2123",keyTxt:"#fff"}
    : {bg:"#1B2023",panel:"#242A2D",line:"#333B3E",txt:"#E6E9EA",dim:"#7C868A",key:"#394145",keyTxt:"#fff"};

  const D=sampleTrade();
  const r=L.radius;
  const shade=(hex,a)=>hex+a;

  const key=(p,i)=>{
    const col=D.colors[i%D.colors.length];
    if(L.keyStyle==="list")return`<div class="pk list" style="border-color:${S.line};color:${S.txt}">
      <span class="pkbar" style="background:${col}"></span>
      <span class="pkn">${esc(p.n)}</span><span class="pkp">${p.p}</span></div>`;
    if(L.keyStyle==="pad")return`<div class="pk pad" style="background:${col};border-radius:${r+8}px;color:#fff">
      <span class="pkn">${esc(p.n)}</span><span class="pkp">${p.p}</span></div>`;
    if(L.keyStyle==="card")return`<div class="pk card" style="background:${S.panel};
      border-color:${S.line};border-radius:${r}px;color:${S.txt}">
      <span class="pkcap" style="background:${col}"></span>
      <span class="pkbody"><span class="pkn">${esc(p.n)}</span>
        ${p.o?`<span class="pko" style="color:${accent}">${esc(p.o)}</span>`:""}</span>
      <span class="pkfoot" style="border-color:${S.line}"><span class="pkp">${p.p}</span>
        <span class="pkadd" style="color:${accent};border-color:${accent}66">Add</span></span></div>`;
    return`<div class="pk tile" style="background:${col};border-radius:${r}px;color:#fff">
      <span class="pkn">${esc(p.n)}</span><span class="pkp">${p.p}</span></div>`;
  };

  const tape=`<div class="ptape ${L.tapeStyle}" style="background:${
      L.tapeStyle==="receipt"?S.panel:S.bg};border-color:${S.line}">
    <div class="pth" style="color:${S.dim};border-color:${S.line}">Current sale</div>
    <div class="ptlines">${D.sale.map(s=>`<div class="ptl" style="color:${S.txt};border-color:${S.line}">
      <span>${esc(s.n)}</span><span class="num">${s.p}</span></div>`).join("")}</div>
    <div class="pttot" style="border-color:${S.line}">
      <span style="color:${S.dim}">Total</span>
      <b style="color:${accent}">${D.total}</b></div>
    <div class="ptpay"><span style="background:${accent}22;border-color:${accent}66;color:${accent}">Cash</span>
      <span style="background:${S.key};border-color:${S.line};color:${S.dim}">Card</span></div>
  </div>`;

  const sections=`<div class="psec ${L.depts}" style="border-color:${S.line}">
    ${D.depts.map((d,i)=>`<span style="color:${i===0?S.txt:S.dim};
      ${L.depts==="rail"?`border-left:2px solid ${i===0?accent:"transparent"}`
        :`border-bottom:2px solid ${i===0?accent:"transparent"}`}">${esc(d)}</span>`).join("")}
  </div>`;

  const board=`<div class="pboard">
    ${L.search?`<div class="psearch" style="background:${S.panel};border-color:${S.line};color:${S.dim}">
      Search the pricebook, or scan a barcode</div>`:""}
    ${L.depts==="rail"
      ? `<div class="prailrow">${sections}<div class="pkeys ${L.keyStyle}">${D.items.map(key).join("")}</div></div>`
      : sections+`<div class="pkeys ${L.keyStyle}">${D.items.map(key).join("")}</div>`}
    ${L.fkeys?`<div class="pfk" style="border-color:${S.line};color:${S.dim}">
      ${["Price check","Void","Discount","No sale","Suspend","Return"].map(f=>
        `<span style="border-color:${S.line}">${f}</span>`).join("")}</div>`:""}
  </div>`;

  el.innerHTML=`
    <div class="bigmock" style="background:${S.bg};border-color:${S.line}">
      <div class="pbar" style="background:${mode==="light"?"#E2E4DF":"#141A1C"};border-color:${S.line}">
        <span class="pdot" style="background:${accent}"></span>
        <b style="color:${S.txt}">${esc(A.name||"Your store")}</b>
        <em style="color:${S.dim}">Reg 1 · Store 001</em>
      </div>
      ${L.nav==="top"?`<div class="pnav top" style="background:${S.panel};border-color:${S.line}">
          ${["Sale","Office","Reports","Config"].map((n,i)=>
            `<span style="color:${i===0?accent:S.dim};background:${i===0?accent+"1A":"transparent"}">${n}</span>`).join("")}
        </div>`:""}
      <div class="pbody ${L.tape} ${L.nav}">
        ${L.nav==="rail"?`<div class="pnav rail" style="background:${
          mode==="light"?"#E2E4DF":"#141A1C"};border-color:${S.line}">
          ${["Sale","Office","Reports","Config"].map((n,i)=>
            `<span style="color:${i===0?accent:S.dim};background:${i===0?accent+"1A":"transparent"}">${n}</span>`).join("")}
        </div>`:""}
        ${L.tape==="left"?tape+board:board+tape}
      </div>
    </div>
    <div class="mocklabel"><b>${esc(L.n)}</b>
      <span>Products as ${L.keyStyle==="list"?"dense rows":L.keyStyle==="pad"?"large pads"
        :L.keyStyle==="card"?"cards with room for options":"tiles"}
      · navigation ${L.nav==="top"?"across the top":"down the side"}
      · order ${L.tape==="bottom"?"along the bottom":"on the "+L.tape}</span></div>`;
}

/* Sample products for the preview, so the difference between the styles is
   visible in something recognisable rather than in grey rectangles. */
function sampleTrade(){
  const t=(A.type+" "+A.desc).toLowerCase();
  const P=["#3A5A52","#57493B","#3D4D66","#573D4D","#485435","#2F4F55"];
  if(/pizz|restaurant|fast food|food truck/.test(t))return{
    depts:["Pizza","Sides","Drinks","Desserts"],colors:P,
    items:[{n:"Cheese 18\" Large",p:"18.99",o:"3 options"},{n:"Pepperoni 18\"",p:"21.99",o:"3 options"},
      {n:"Garlic Knots",p:"6.49"},{n:"Buffalo Wings",p:"12.99",o:"2 options"},
      {n:"Coke 20 oz",p:"2.49"},{n:"Cannoli",p:"4.50"}],
    sale:[{n:"Cheese 18\" Large",p:"18.99"},{n:"Garlic Knots",p:"6.49"},{n:"Coke 20 oz",p:"2.49"}],
    total:"29.44"};
  if(/caf|coffee|bakery|juice/.test(t))return{
    depts:["Espresso","Brewed","Pastry","Retail"],colors:P,
    items:[{n:"Latte",p:"4.75",o:"Size, milk"},{n:"Cappuccino",p:"4.50",o:"Size, milk"},
      {n:"Cold Brew",p:"5.25",o:"Size"},{n:"Croissant",p:"3.95"},
      {n:"Drip Coffee",p:"2.95",o:"Size"},{n:"Blueberry Muffin",p:"3.50"}],
    sale:[{n:"Latte · Large, oat",p:"5.75"},{n:"Croissant",p:"3.95"}],total:"10.42"};
  if(/cloth|boutique|shoe|jewel|watch|handbag/.test(t))return{
    depts:["New in","Tops","Bottoms","Accessories"],colors:P,
    items:[{n:"Heavyweight Hoodie",p:"79.99",o:"S–XXL"},{n:"Boxy Tee",p:"39.99",o:"S–XL, 4 colours"},
      {n:"Wide-Leg Trouser",p:"89.99",o:"26–34"},{n:"Leather Belt",p:"45.00",o:"3 sizes"},
      {n:"Cotton Socks",p:"12.00"},{n:"Canvas Tote",p:"28.00"}],
    sale:[{n:"Heavyweight Hoodie · L",p:"79.99"},{n:"Cotton Socks",p:"12.00"}],total:"99.36"};
  if(/bar|pub|brewery|taproom/.test(t))return{
    depts:["Draught","Bottles","Spirits","Wine","Food"],colors:P,
    items:[{n:"House IPA Pint",p:"7.50"},{n:"Lager Pint",p:"6.50"},{n:"Well Whiskey",p:"8.00"},
      {n:"House Red",p:"9.00"},{n:"Loaded Fries",p:"11.00"},{n:"Wings",p:"13.50"}],
    sale:[{n:"House IPA Pint",p:"7.50"},{n:"2 × Lager Pint",p:"13.00"},{n:"Loaded Fries",p:"11.00"}],
    total:"34.28"};
  if(/grocer|market|butcher|produce|cheese/.test(t))return{
    depts:["Produce","Dairy","Meat","Bakery","Pantry"],colors:P,
    items:[{n:"Bananas per lb",p:"0.69"},{n:"Whole Milk 1 gal",p:"4.29"},
      {n:"Ground Chuck per lb",p:"6.49"},{n:"Sourdough Loaf",p:"5.50"},
      {n:"Large Eggs Dozen",p:"3.99"},{n:"Roma Tomatoes per lb",p:"2.29"}],
    sale:[{n:"Whole Milk 1 gal",p:"4.29"},{n:"Large Eggs Dozen",p:"3.99"},{n:"1.4 lb Bananas",p:"0.97"}],
    total:"9.42"};
  return{
    depts:["Beverages","Snacks","Tobacco","Grocery","Lottery"],colors:P,
    items:[{n:"Fountain 32 oz",p:"1.79"},{n:"Coffee 16 oz",p:"1.99"},
      {n:"Monster Ultra",p:"3.99"},{n:"Marlboro Red Box",p:"11.49",o:"21+"},
      {n:"Lay's Classic",p:"2.29"},{n:"Snickers",p:"1.89"}],
    sale:[{n:"Coffee 16 oz",p:"1.99"},{n:"Marlboro Red Box",p:"11.49"},{n:"Snickers",p:"1.89"}],
    total:"16.75"};
}

draw();

/* ========================= AI generation ========================= */
function parseLoose(raw){
  let s=raw.replace(/```json|```/g,"").trim();
  try{return JSON.parse(s)}catch(e){}
  const cut=Math.max(s.lastIndexOf("}"),s.lastIndexOf("]"));
  if(cut>-1)s=s.slice(0,cut+1);
  const st=[];let inStr=false,bs=false;
  for(const ch of s){
    if(inStr){if(bs)bs=false;else if(ch==="\\")bs=true;else if(ch==='"')inStr=false;continue}
    if(ch==='"')inStr=true;else if(ch==="{"||ch==="[")st.push(ch);else if(ch==="}"||ch==="]")st.pop();
  }
  if(inStr)s+='"';
  s=s.replace(/,\s*$/,"");
  while(st.length)s+=st.pop()==="{"?"}":"]";
  return JSON.parse(s);
}
async function callAI(prompt,opts={}){
  const body={model:"claude-sonnet-4-6",max_tokens:opts.max_tokens||1000,
    messages:opts.messages||[{role:"user",content:prompt}]};
  if(opts.tools)body.tools=opts.tools;
  const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",
    headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const d=await r.json();
  if(d.error)throw new Error(d.error.message||"API error");
  return parseLoose(d.content.filter(b=>b.type==="text").map(b=>b.text).join(""));
}
/* Ask the model what a fitter would ask this particular trade, and which of the
   modules we actually have would earn their place. It picks from a fixed list —
   it cannot invent a feature, only recognise a need for one that exists. */
async function askTrade(){
  try{
    const r=await callAI(`You are setting up a point-of-sale system and want to ask the owner the two
or three questions that actually matter for THEIR trade — not a generic script.

${ctx()}
Sells: ${A.desc}

Available modules (you may only choose from these, by key):
${Object.entries(MODULES).map(([k,m])=>`  ${k} — ${m.n}: ${m.what}`).join("\n")}

Return ONLY valid JSON, no prose or fences:
{"questions":[{"q":string,"opts":[string],"why":string}],"modules":[string]}

- 4 or 5 questions, specific to this trade, that change how the register should be set up.
  A café gets asked whether drinks come in sizes, whether milk alternatives cost extra, whether
  they keep recipes and yields, whether there's a pastry case that gets marked down late, and
  whether staff share tips. A convenience store gets asked about age-restricted lines, whether
  they run lottery, whether the cooler gets date-checked, and whether they take EBT. A butcher
  gets asked who breaks down the primals, whether cuts are logged, whether they sell by weight,
  and how long trays stay out. Ask what a fitter who knew this trade would ask. Never ask
  something already answered above.
- "opts": 2 to 4 short answers. Keep them concrete.
- "why": one short line on what the answer changes in the register. Plain language, no jargon.
  Name the actual consequence — "turns on a size prompt when these are rung", not "improves setup".
- "modules": the keys worth switching on for this business, with the reason tied to what they
  actually sell. Empty array if none fit. Do not invent keys.`,
      {max_tokens:1400,kind:"trade-questions"});
    TRADE_Q=(r.questions||[]).slice(0,3).filter(q=>q&&q.q);
    REC_MODS=(r.modules||[]).filter(k=>MODULES[k]);
    A.mods=[...REC_MODS];
  }catch(e){
    /* No questions is better than made-up questions. */
    TRADE_Q=[];REC_MODS=Object.keys(MODULES).filter(k=>MODULES[k].fits.test(A.type+" "+A.desc));
    A.mods=[...REC_MODS];
  }
  if(STEP===STEPS.length-1)draw();
}

function ctx(){return`Business type: ${A.type}${A.typeOther?` (${A.typeOther})`:""}
Store name: ${A.name}
Owner's description: ${A.desc}
Modules enabled: ${A.caps.length?A.caps.join(", "):"none"}${
  TRADE_Q.length?"\n"+TRADE_Q.map((q,i)=>`${q.q} ${A.trade[i]||"—"}`).join("\n"):""}`}
function itemRules(){
  const r=["Real, specific product names and realistic US retail prices. No placeholders.",
    `"upc": a unique plausible 12-digit UPC string per item.`];
  r.push(A.caps.includes("age")?`"age": 21 for tobacco/vape/alcohol, 18 where correct, else null.`:`"age": always null.`);
  r.push(A.caps.includes("weight")?`"wt": true only for items truly sold per pound, "p" being the price per pound.`:`"wt": always null.`);
  r.push(A.caps.includes("ebt")?`"ebt": true on SNAP-eligible grocery staples.`:`"ebt": always null.`);
  r.push(A.caps.includes("deposit")?`"dep": bottle deposit in dollars like 0.05 on canned or bottled drinks.`:`"dep": always null.`);
  return r.map(x=>"- "+x).join("\n");
}
async function build(){
  $("setup").classList.add("hide");$("building").style.display="flex";
  let lines=[{t:"Reading your description",s:1}],note="";
  const paint=()=>{
    const done=lines.filter(l=>l.s===2).length;
    const pct=Math.round(done/Math.max(1,lines.length)*100);
    const now=lines.find(l=>l.s===1);
    $("buildBody").innerHTML=`
      <div class="bs">
        <div class="bsorb"><i></i><i></i><i></i></div>
        <div class="bskicker">Setting up ${esc(A.name||"your store")}</div>
        <h2 class="bstitle">Building your POS</h2>
        <div class="bsnow">${esc(now?now.t:"Almost there")}<span class="bsdots"><i></i><i></i><i></i></span></div>
        <div class="bsbar"><span style="width:${pct}%"></span></div>
        <div class="bslist">${lines.map((l,i)=>`
          <div class="bsl ${l.s===2?"done":l.s===3?"skip":l.s===1&&l===now?"now":""}"
            style="animation-delay:${i*45}ms">
            <span class="bsm">${l.s===2?"\u2713":l.s===3?"!":""}</span>
            <span>${esc(l.t)}</span></div>`).join("")}</div>
        ${note?`<div class="bsnote">${esc(note)}</div>`:""}
      </div>`;
  };
  paint();

  let shell=null,failed=null;
  /* If enough of this trade already exists, start from what they settled on
     rather than asking a model to imagine it. */
  if(FLEET&&FLEET.depts&&FLEET.depts.length>=3){
    shell={tagline:"",addr:"",
      depts:FLEET.depts.slice(0,7).map(d=>({n:d.n,food:/grocer|food|produce|dairy|bakery/i.test(d.n)}))};
    lines[0].t=`Starting from ${FLEET.contributors} other ${A.type.toLowerCase()}s`;
  }
  try{
    if(!shell)shell=await callAI(`You are setting up a point-of-sale system for a real small business. Return ONLY valid JSON, no prose or fences:
{"tagline":string,"addr":string,"depts":[{"n":string,"food":boolean}]}

${ctx()}

Rules:
- 5 or 6 departments, ordered by how often a cashier touches them. Names only — no items yet.
- "food": true for departments of grocery food that would get a reduced tax rate.
- Never create a fuel department; fuel is handled separately.
- "tagline": five words max. "addr": a plausible street address line.`);
  }catch(e){failed=e.message}
  if(!shell||!Array.isArray(shell.depts)||!shell.depts.length){
    $("buildBody").innerHTML=`<h2>Couldn't reach the model</h2>
      <div class="err">Loading a generic site configuration built from your answers instead. Fully usable, just not tailored. Everything is editable under Config.<br><br><span style="color:var(--ink-soft)">${esc(failed||"No departments came back.")}</span></div>
      <div class="nav"><button class="go" id="fb">Open the terminal</button></div>`;
    $("fb").onclick=()=>{CFG=compile(FALLBACK());boot()};return;
  }
  lines[0].s=2;
  const deptNames=shell.depts.map(d=>d.n);
  lines.push({t:`Working out the tax categories for ${A.loc}`,s:1});paint();
  try{
    TAXINFO=await lookupTax(A.loc,A.type,deptNames);
    lines[1].s=2;
    lines[1].t=`${TAXINFO.categories.length} tax categories for ${TAXINFO.place||A.loc}`
      +` — ${TAXINFO.categories.map(c=>c.rate+"%").join(", ")}`
      +(TAXINFO.conflict?" (sources disagreed — confirm before you open)":" (confirm before you open)");
  }catch(e){
    TAXINFO=null;lines[1].s=3;
    lines[1].t="Couldn't confirm the tax rate ("+(e.message||"unknown")+") — set it under Site & tax";
  }
  paint();
  const depts=shell.depts.slice(0,7);
  lines.push({t:"Laying out "+depts.length+" departments",s:2});
  lines.push({t:"Ready for your products",s:1});paint();
  /* Departments are structure and safe to suggest. Products are not — an
     invented price with an invented barcode looks exactly like a real one, and
     somebody will eventually ring a sale on it. So we stop here and ask. */
  lines[lines.length-1]={t:"Ready for your products",s:2};
  paint();
  const gen={tagline:shell.tagline||"",addr:shell.addr||"",promos:[],
    depts:depts.map(d=>({n:d.n,food:!!d.food,items:[]}))};

  setTimeout(()=>askHowToFill(gen,depts),400);
}

/* Four ways in, and the honest default is not "let the model make some up". */
function askHowToFill(gen,depts){
  $("buildBody").innerHTML=`
    <h2>How do you want to fill the pricebook?</h2>
    <p class="sub" style="margin-bottom:26px">${depts.length} departments are set up for
      ${esc(A.name)} — ${esc(depts.map(d=>d.n).join(", "))}. Now the products.</p>
    <div class="fillopts">
      <button data-f="import"><b>Import a file</b>
        <span>A CSV or NAXML export from your current POS, a spreadsheet, or a distributor item file.
          Columns get matched for you and shown before anything is written.</span></button>
      <button data-f="invoice"><b>Read my invoices</b>
        <span>Photograph or upload vendor invoices. Products, costs and departments come off the paper,
          priced at your ${A.margin}% margin. Anything unclear is held for you to check.</span></button>
      <button data-f="empty"><b>Start empty</b>
        <span>Add products yourself as you go, or scan them in at the register. Nothing is
          created that you didn't put there.</span></button>
      <button data-f="demo" class="dim"><b>Fill it with examples</b>
        <span>Made-up products at made-up prices, so you can see the register working. Useful for a
          look around, not for a real store — they're marked and can be cleared in one click.</span></button>
    </div>`;
  $("buildBody").querySelectorAll("[data-f]").forEach(b=>b.onclick=()=>{
    const how=b.dataset.f;
    if(how==="demo")return fillWithExamples(gen,depts);
    CFG=compile(gen);
    if(typeof saveNow==="function")saveNow();
    OPEN_AFTER=how==="import"?"import":how==="invoice"?"invoice":null;
    openStudio();
  });
}
let OPEN_AFTER=null;

async function fillWithExamples(gen,depts){
  const lines=depts.map(d=>({t:"Pricing "+d.n,s:1}));
  lines.push({t:"Building deals",s:1});
  const paint=()=>$("buildBody").innerHTML=`<h2>Building example products</h2>`
    +lines.map(l=>`<div class="tick-line ${l.s===2?"done":""}"><b>${l.s===2?"✓":l.s===3?"!":"·"}</b><span>${esc(l.t)}</span></div>`).join("")
    +`<div class="hint">These are illustrations at made-up prices, not your pricebook. They're marked
      as examples and can be cleared in one action from Config → Pricebook.</div>`;
  paint();

  const res=await Promise.all(depts.map(async(d,i)=>{
    try{
      const r=await callAI(`Write example products for one department of a point-of-sale pricebook.
These are illustrative, so the owner can see the register working before loading their real pricebook.

Return ONLY valid JSON, no prose or fences:
{"items":[{"n":string,"p":number,"upc":string,"age":number|null,"wt":boolean|null,"ebt":boolean|null,"dep":number|null}]}

${ctx()}
Department: ${d.n}

Rules:
- Exactly 5 items that genuinely belong in this department at this business.
${itemRules()}`);
      lines[i].s=2;paint();
      return Array.isArray(r.items)?r.items.filter(x=>x&&x.n):[];
    }catch(e){
      lines[i].s=3;lines[i].t=d.n+" — skipped";paint();
      return [];
    }
  }));

  gen.depts=depts.map((d,i)=>({n:d.n,food:!!d.food,items:res[i]})).filter(d=>d.items.length);
  if(!gen.depts.length){
    CFG=compile(gen);
    if(typeof saveNow==="function")saveNow();
    return openStudio();
  }

  const upcs=gen.depts.flatMap(d=>d.items.map(i=>i.upc)).filter(Boolean);
  try{
    const p=await callAI(`Example products at ${A.name} (${A.type}), as "name | upc | price":
${gen.depts.flatMap(d=>d.items.map(i=>`${i.n} | ${i.upc} | ${i.p}`)).join("\n")}

Return ONLY valid JSON, no prose or fences:
{"promos":[{"n":string,"upcs":string[],"qty":number,"price":number}]}

Write 1 or 2 realistic mix-and-match deals a store like this would run. Only reference upcs above.
Return an empty array if none fit.`);
    gen.promos=(p.promos||[]).filter(x=>x&&Array.isArray(x.upcs)&&x.upcs.some(u=>upcs.includes(u)));
    lines[lines.length-1].s=2;
  }catch(e){lines[lines.length-1].s=3;lines[lines.length-1].t="Deals skipped"}
  paint();

  CFG=compile(gen);
  /* Marked so they can be found and removed as a set later. */
  CFG.plus.forEach(p=>p.starter=true);
  if(typeof saveNow==="function")saveNow();
  setTimeout(openStudio,340);
}

function FALLBACK(){return{tagline:"Thanks for stopping in",addr:"",promos:[],depts:[
  {n:"Drinks",food:false,items:[{n:"Fountain 32 oz",p:1.79,upc:"000000000101"},{n:"Coffee 16 oz",p:1.99,upc:"000000000102"},
   {n:"Bottled Water",p:1.49,upc:"000000000103"},{n:"Energy Drink",p:3.99,upc:"000000000104"}]},
  {n:"Snacks",food:true,items:[{n:"Chips",p:2.29,upc:"000000000201"},{n:"Candy Bar",p:1.89,upc:"000000000202"},
   {n:"Beef Jerky",p:5.49,upc:"000000000203"},{n:"Gum",p:1.79,upc:"000000000204"}]},
  {n:"Grocery",food:true,items:[{n:"Bread",p:3.49,upc:"000000000301"},{n:"Milk 1 gal",p:4.29,upc:"000000000302"},
   {n:"Eggs Dozen",p:3.99,upc:"000000000303"},{n:"Cereal",p:5.29,upc:"000000000304"}]}]}}

/* ========================= compile ========================= */
function compile(gen){
  /* One rate per category the state actually distinguishes, not a hardcoded
     standard-and-food pair. In Illinois that means candy and soft drinks sit at
     the general rate even though they look like groceries. */
  const taxRates=[];const keyToId={};
  if(TAXINFO&&Array.isArray(TAXINFO.categories)&&TAXINFO.categories.length){
    TAXINFO.categories.forEach((c,i)=>{
      const id="TX"+(i+1);keyToId[c.key]=id;
      taxRates.push({id,n:c.n||c.key,rate:+(+c.rate||0).toFixed(3),what:c.what||null,
        why:c.why||null,carveOut:!!c.carveOut,examples:c.examples||[],notIn:c.notIn||[],
        parts:(i===0?TAXINFO.breakdown:null)||null,src:(i===0?TAXINFO.note:null)||null});
    });
  } else {
    taxRates.push({id:"TX1",n:"General merchandise",rate:0,src:"Set this under Site & tax."});
    keyToId.general="TX1";
  }
  if(!taxRates.some(r=>r.rate===0)){taxRates.push({id:"TX0",n:"Non-taxable",rate:0});keyToId.exempt="TX0"}
  else keyToId.exempt=keyToId.exempt||taxRates.find(r=>r.rate===0).id;
  const generalId=keyToId.general||taxRates[0].id;
  const deptTax=(TAXINFO&&TAXINFO.deptTax)||{};
  const taxFor=name=>keyToId[deptTax[name]]||generalId;
  const restricts=[];
  const c={site:{name:A.name||"Your Store",tagline:gen.tagline||"",addr:gen.addr||"",
      store:"001",register:"1",loc:A.loc,logo:A.logo||"",slogan:A.slogan||""},
    caps:[...A.caps],rounding:{nickel:false},bizType:A.type,
    layout:A.layout||suggestLayout(),
    theme:{mode:A.mode||"dark",accent:A.accent||suggestAccent()},
    receipt:{footer:A.footer||"",policy:A.policy||""},
    openingCash:parseFloat(A.startCash)||200,
    tax:TAXINFO?{place:TAXINFO.place,state:TAXINFO.state,sources:TAXINFO.sources||[],
      verifyUrl:TAXINFO.verifyUrl||"",conflict:TAXINFO.conflict||null,sumNote:TAXINFO.sumNote||null,
      recent:TAXINFO.recent||null,confirmed:false,searched:true}:{confirmed:false},
    pricing:{margin:parseFloat(A.margin)||35,ending:A.ending,dir:A.dir,
      mode:A.priceMode||"margin"},
    modules:Object.fromEntries((A.mods||[]).map(k=>[k,{on:true,cfg:{}}])),
    trade:TRADE_Q.map((q,i)=>({q:q.q,a:A.trade[i]||null})),
    taxRates,depts:[],plus:[],menus:[],mops:[],restricts,promos:[],
    groups:[],employees:[],reasons:[],modGroups:[],reminders:[]};

  gen.depts.forEach((d,i)=>{
    const dept={id:"D"+(i+1),n:d.n,taxId:taxFor(d.n),food:!!d.food,color:PALETTE[i%PALETTE.length]};
    c.depts.push(dept);
    (d.items||[]).forEach(it=>{
      let rid=null;
      if(it.age&&A.caps.includes("age")){
        let r=restricts.find(x=>x.minAge===it.age&&!x.start);
        if(!r){r={id:"R"+(restricts.length+1),n:it.age+"+ age check",minAge:it.age,idScan:true,start:"",end:""};restricts.push(r)}
        rid=r.id;
      }
      c.plus.push({id:"P"+uid(),upc:it.upc||"",n:it.n,price:+it.p||0,deptId:dept.id,
        weighed:!!(it.wt&&A.caps.includes("weight")),ebt:!!(it.ebt&&A.caps.includes("ebt")),
        deposit:(A.caps.includes("deposit")&&it.dep)?+it.dep:null,restrictId:rid,modIds:[],cost:null});
    });
  });

  // Modifier groups — Toast/Square shape: a group is required or optional,
  // single or multi select, and each option can carry its own price delta.
  if(A.caps.includes("foodservice")){
    c.modGroups=[
      {id:"MG1",n:"Size",required:true,multi:false,opts:[{n:"Small",p:0},{n:"Medium",p:.5},{n:"Large",p:1}]},
      {id:"MG2",n:"Add-ons",required:false,multi:true,opts:[{n:"Extra cheese",p:.75},{n:"Bacon",p:1.25},
        {n:"Jalapeños",p:.35},{n:"Extra sauce",p:0}]},
      {id:"MG3",n:"Prepared",required:false,multi:true,opts:[{n:"To go",p:0},{n:"Heated",p:0},{n:"Cut in half",p:0}]}];
    const hot=/coffee|food|deli|grill|kitchen|bakery|caf|pizza|sandwich|hot|breakfast|snack bar/i;
    c.depts.filter(d=>hot.test(d.n)).forEach(d=>
      c.plus.filter(p=>p.deptId===d.id).forEach(p=>p.modIds=["MG1","MG2","MG3"]));
  }

  c.menus=c.depts.map(d=>({id:"M"+d.id,n:d.n,color:d.color,
    keys:c.plus.filter(p=>p.deptId===d.id).map(p=>({pluId:p.id}))}));

  if(A.caps.includes("fuel")){
    const fd={id:"DF",n:"Fuel",taxId:keyToId.exempt,food:false,fuel:true,color:"#2C3A3E"};
    c.depts.unshift(fd);
    c.menus.unshift({id:"MDF",n:"Fuel",color:fd.color,fuel:true,keys:[1,2,3,4,5,6,7,8].map(i=>({pump:i,label:"Pump "+i}))});
  }

  c.mops=[{id:"MOP1",n:"Cash",kind:"cash",drawer:true,change:true,rounds:true},
    {id:"MOP2",n:"Credit",kind:"card",drawer:false,change:false},
    {id:"MOP3",n:"Debit",kind:"card",drawer:false,change:false}];
  if(A.caps.includes("ebt"))c.mops.push({id:"MOP4",n:"EBT",kind:"ebt",drawer:false,change:false,ebtOnly:true});

  if(A.caps.includes("age")&&/liquor|beer|wine|alcohol/i.test(A.desc+" "+A.type))
    restricts.push({id:"RT",n:"No alcohol 2–7am",minAge:21,idScan:true,start:"02:00",end:"07:00"});

  (gen.promos||[]).forEach((p,i)=>{
    const ids=(p.upcs||[]).map(u=>c.plus.find(x=>x.upc===u)?.id).filter(Boolean);
    if(ids.length)c.promos.push({id:"PR"+(i+1),n:p.n,kind:"mixmatch",pluIds:ids,qty:+p.qty||2,price:+p.price||0,on:true});
  });

  // Security groups — Passport's model: permissions attach to a group, not a person.
  c.groups=[
    {id:"G1",n:"Cashier",perms:["nosale"]},
    {id:"G2",n:"Shift lead",perms:["nosale","void","discount","refund","reports"]},
    {id:"G3",n:"Manager",perms:PERMS.map(p=>p[0])}];
  const roleGroup={Manager:"G3","Shift lead":"G2",Cashier:"G1"};
  c.employees=(A.staff&&A.staff.length?A.staff:[{n:"Manager",role:"Manager",pin:"1234"}])
    .map((s,i)=>({id:"E"+(i+1),n:s.n.trim()||("Person "+(i+1)),pin:s.pin||String(1111*(i+1)).slice(0,4),
      groupId:roleGroup[s.role]||"G1"}));

  // Reason codes on exceptions — the anti-shrink control.
  c.reasons=[
    {id:"RC1",n:"Customer changed mind",type:"void"},{id:"RC2",n:"Rang in error",type:"void"},
    {id:"RC3",n:"Item damaged",type:"void"},{id:"RC4",n:"Wrong price",type:"void"},
    {id:"RC5",n:"Defective product",type:"refund"},{id:"RC6",n:"Not as expected",type:"refund"},
    {id:"RC7",n:"Vendor payment",type:"payout"},{id:"RC8",n:"Supplies",type:"payout"},
    {id:"RC9",n:"Make change",type:"nosale"},{id:"RC10",n:"Drawer check",type:"nosale"}];

  c.reminders=[
    {id:"T1",n:"Brew fresh coffee",at:"06:00",done:false},{id:"T2",n:"Check cooler temperatures",at:"09:00",done:false},
    {id:"T3",n:"Clean restrooms",at:"12:00",done:false},{id:"T4",n:"Count cigarette inventory",at:"16:00",done:false},
    {id:"T5",n:"Take out trash",at:"21:00",done:false}];
  return c;
}

/* ========================= session & permissions ========================= */
function can(perm){const g=byId(CFG.groups,ME?.groupId);return !!g&&g.perms.includes(perm)}
/* If the signed-in cashier lacks the permission, a manager keys in over them.
   The override is logged against the shift, not silently swallowed. */
function auth(perm,label,cb){
  if(can(perm))return cb(ME);
  pinPrompt(`Manager approval needed`,`${label} is outside ${esc(ME.n)}'s permissions. A manager can approve it.`,
    emp=>{const g=byId(CFG.groups,emp.groupId);
      if(!g.perms.includes(perm))return toast(`${emp.n} can't approve that either.`,true);
      SHIFT.exceptions.push({at:new Date(),by:emp.n,on:ME.n,what:label});
      cb(emp);});
}
function pinPrompt(title,body,ok){
  let pin="";
  const el=veil(`<div class="card" style="max-width:320px"><h3>${title}</h3><p>${body}</p>
    <div class="pindots" id="apd">${[0,1,2,3].map(()=>`<i></i>`).join("")}</div>
    <div class="lockpad">${[1,2,3,4,5,6,7,8,9,"",0,"←"].map(k=>
      k===""?`<span></span>`:`<button data-k="${k}">${k}</button>`).join("")}</div>
    <div class="row"><button class="no" id="an">Cancel</button></div></div>`);
  const dots=()=>el.querySelectorAll("#apd i").forEach((d,i)=>d.classList.toggle("f",i<pin.length));
  el.querySelectorAll("[data-k]").forEach(b=>b.onclick=()=>{
    const k=b.dataset.k;
    if(k==="←")pin=pin.slice(0,-1);else if(pin.length<4)pin+=k;
    dots();
    if(pin.length===4){
      const emp=CFG.employees.find(e=>e.pin===pin);
      if(emp){el.remove();ok(emp)}
      else{el.querySelector("#apd").classList.add("bad");
        setTimeout(()=>{pin="";dots();el.querySelector("#apd").classList.remove("bad")},420)}
    }});
  el.querySelector("#an").onclick=()=>el.remove();
}
function reasonPrompt(type,title,cb){
  const list=CFG.reasons.filter(r=>r.type===type);
  if(!list.length)return cb(null);
  const el=veil(`<div class="card"><h3>${esc(title)}</h3><p>Pick a reason. It's recorded against the shift so exceptions can be reviewed later.</p>
    <div class="opts" style="flex-direction:column">${list.map(r=>
      `<button data-r="${r.id}" style="width:100%">${esc(r.n)}</button>`).join("")}</div>
    <div class="row"><button class="no" id="rn">Cancel</button></div></div>`);
  el.querySelector("#rn").onclick=()=>el.remove();
  el.querySelectorAll("[data-r]").forEach(b=>b.onclick=()=>{el.remove();cb(byId(CFG.reasons,b.dataset.r))});
}

/* ========================= shell ========================= */
const ICONS={
  sale:'<path d="M3 3h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6"/><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/>',
  office:'<path d="M3 21h18M5 21V7l7-4 7 4v14"/><path d="M10 21v-5h4v5"/>',
  reports:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  config:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  lock:'<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  cart:'<path d="M3 3h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6"/><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'
};
const NAV=[["sale","Sale","sale",null],["office","Office","office",null],
  ["reports","Reports","reports","reports"],["config","Config","config","config"]];

function boot(){
  $("building").style.display="none";$("setup").classList.add("hide");
  /* Asking for a PIN the owner set four minutes ago, seconds after a launch
     sequence, is a flat ending. Sign the person who built it straight in; the
     lock is there for the next person to touch the terminal. */
  if(AUTO_IN){
    AUTO_IN=false;
    const mgr=CFG.employees.find(e=>byId(CFG.groups,e.groupId)?.perms.includes("config"))
      ||CFG.employees[0];
    if(mgr){ME=mgr;$("lock").classList.remove("on");return startShell()}
  }
  signIn();
}
let AUTO_IN=false;
function signIn(){
  /* Reaching here without a configuration is a bug elsewhere, but a blank
     screen with four dots on it helps nobody diagnose it. */
  if(!CFG||!CFG.site||!Array.isArray(CFG.employees)||!CFG.employees.length){
    $("lock").classList.add("on");
    $("lockName").textContent="Setup incomplete";
    $("lockSub").textContent="";
    $("lockPad").innerHTML="";
    $("lockDots").innerHTML="";
    $("lockMsg").className="lockmsg bad";
    $("lockMsg").innerHTML=`This store has no usable configuration, so there's nobody to sign in.
      <br><br><button class="tbtn2" onclick="localStorage.removeItem('pos_store');location.reload()"
        style="margin-top:10px">Start over</button>`;
    return;
  }
  $("app").classList.remove("on");$("lock").classList.add("on");
  let pin="";
  const dots=()=>$("lockDots").querySelectorAll("i").forEach((d,i)=>d.classList.toggle("f",i<pin.length));
  $("lockName").textContent=CFG.site.name;
  $("lockSub").textContent=`Register ${CFG.site.register} · Store ${CFG.site.store}`;
  $("lockMsg").innerHTML=`Enter your 4-digit code. <span style="color:var(--txt-3)">Try 1234, 2222 or 1111.</span>`;
  $("lockMsg").className="lockmsg";
  $("lockPad").innerHTML=[1,2,3,4,5,6,7,8,9,"",0,"←"].map(k=>
    k===""?`<span></span>`:`<button data-k="${k}">${k}</button>`).join("");
  dots();
  $("lockPad").querySelectorAll("[data-k]").forEach(b=>b.onclick=()=>{
    const k=b.dataset.k;
    if(k==="←")pin=pin.slice(0,-1);else if(pin.length<4)pin+=k;
    dots();
    if(pin.length===4){
      const emp=CFG.employees.find(e=>e.pin===pin);
      if(emp){ME=emp;pin="";startShell()}
      else{$("lockDots").classList.add("bad");$("lockMsg").textContent="That code isn't recognised.";
        $("lockMsg").className="lockmsg bad";
        setTimeout(()=>{pin="";dots();$("lockDots").classList.remove("bad")},430)}
    }});
}
function startShell(){
  $("lock").classList.remove("on");$("app").classList.add("on");
  const mark=$("hdrMark");
  if(mark)mark.innerHTML=CFG.site.logo
    ?`<img src="${esc(CFG.site.logo)}" alt="">`:`<span class="dot"></span>`;
  $("hdrName").textContent=CFG.site.name;
  $("hdrMeta").textContent=`Reg ${CFG.site.register} · Store ${CFG.site.store}`;
  drawRail();themeFromConfig();clock();setInterval(clock,1000);
  $("btnLock").onclick=()=>{ME=null;signIn()};
  wireSale();
  if(typeof OPEN_AFTER!=="undefined"&&OPEN_AFTER){
    const t=OPEN_AFTER;OPEN_AFTER=null;
    go("config");TAB=t;drawConfig();
  } else go("sale");
  toast(`Signed in as <b>${esc(ME.n)}</b> · ${esc(byId(CFG.groups,ME.groupId).n)}`);
}
function clock(){
  const d=new Date();
  $("hdrClock").textContent=d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"});
  $("hdrUser").innerHTML=`<b>${esc(ME?.n||"")}</b>`;
  const due=CFG.reminders.filter(t=>!t.done&&hhmm(d)>=t.at).length;
  const b=document.querySelector('.rbtn[data-v="office"] .badge');
  if(b){b.textContent=due;b.style.display=due?"grid":"none"}
}
function drawRail(){
  $("rail").innerHTML=NAV.map(([k,label,ic,perm])=>
    `<button class="rbtn ${k===VIEW?"on":""}" data-v="${k}" ${perm&&!can(perm)?'disabled style="opacity:.3"':""}>
      <svg viewBox="0 0 24 24">${ICONS[ic]}</svg><span>${label}</span>
      ${k==="office"?`<span class="badge" style="display:none">0</span>`:""}</button>`).join("")
    +`<div class="railfoot"><button class="rbtn" id="railLock"><svg viewBox="0 0 24 24">${ICONS.lock}</svg><span>Lock</span></button></div>`;
  $("rail").querySelectorAll("[data-v]").forEach(b=>b.onclick=()=>{
    const perm=NAV.find(n=>n[0]===b.dataset.v)[3];
    if(perm&&!can(perm))return auth(perm,`Opening ${b.dataset.v}`,()=>go(b.dataset.v));
    go(b.dataset.v)});
  $("railLock").onclick=()=>{ME=null;signIn()};
}
function go(v){
  VIEW=v;drawRail();
  /* Only the sale screen is handed over to a shell. Office, Reports and Config
     stay in the shared chrome, or there'd be four of everything. */
  document.body.classList.toggle("own-chrome",
    typeof THEME!=="undefined"&&THEME.chrome==="own"&&v==="sale");
  ["vSale","vOffice","vReports","vConfig"].forEach(id=>$(id).classList.remove("on"));
  $({sale:"vSale",office:"vOffice",reports:"vReports",config:"vConfig"}[v]).classList.add("on");
  if(v==="office")drawOffice();
  if(v==="reports")drawReports();
  if(v==="config")drawConfig();
}
function veil(html){
  const el=document.createElement("div");el.className="veil";el.innerHTML=html;
  document.body.appendChild(el);
  el.onclick=e=>{if(e.target===el)el.remove()};
  return el;
}
function toast(html,bad){
  $("statusbar").innerHTML=`<span style="${bad?"color:var(--void)":""}">${html}</span>`
    +`<span style="margin-left:auto;color:var(--txt-3);font-size:12px">${TRAIN?"Training mode · nothing posts":""}</span>`;
}

/* ========================= sale view ========================= */
function wireSale(){
  $("grid").addEventListener("pointerdown",keyBloom);
  $("search").oninput=e=>{FILTER=e.target.value.trim();drawGrid()};
  $("search").onkeydown=e=>{if(e.key==="Enter"){const p=CFG.plus.find(x=>x.upc===FILTER);
    if(p){ring(p);$("search").value="";FILTER="";drawGrid()}}};
  $("tenders").onclick=e=>{const b=e.target.closest(".tender");if(b&&CART.length)tender(byId(CFG.mops,b.dataset.m))};
  const sh=typeof THEME!=="undefined"&&THEME.shell;
  if(sh&&sh!=="panels"){refreshSale();wedge()}
  else{renderTenders();renderSubops();renderFkeys();drawMenus();drawGrid();refreshSale();wedge()}
  if(THEME.searchLeads!==false&&$("search"))setTimeout(()=>$("search").focus(),120);
  toast("Tap a key, scan a barcode, or search to start a sale.");
}
function renderTenders(){
  if(typeof modOn==="function"&&modOn("giftcards")&&!CFG.mops.some(m=>m.kind==="gift"))
    CFG.mops.push({id:"MOP"+uid(),n:"Gift card",kind:"gift",drawer:false,change:false});
  $("tenders").innerHTML=CFG.mops.map(m=>
    `<button class="tender ${m.kind==="cash"?"cash":""}" data-m="${m.id}">${esc(m.n)}</button>`).join("");
}
function renderSubops(){
  $("subops").innerHTML=`<button id="oDisc">Discount</button><button id="oHold">Hold</button>
    <button id="oRecall">Recall${HELD.length?" ("+HELD.length+")":""}</button><button id="oClear">Clear</button>`;
  $("oDisc").onclick=()=>auth("discount","Sale discount",discPrompt);
  $("oHold").onclick=hold;$("oRecall").onclick=recall;
  $("oClear").onclick=()=>{if(CART.length)auth("void","Clearing the sale",()=>{
    CART=[];SEL=null;DISC=null;refreshSale();toast("Sale cleared.")})};
}
const FKEYS=[["F1","Price check",()=>priceCheck()],["F2","Void line",()=>{if(SEL!=null)voidLine(SEL)}],
  ["F3","Discount",()=>auth("discount","Sale discount",discPrompt)],["F4","No sale",()=>noSale()],
  ["F5","Suspend",()=>hold()],["F6","Recall",()=>recall()],
  ["F7","Return",()=>auth("refund","Return mode",toggleReturn)],["F8","Pay out",()=>auth("payout","Pay out",payOut)]];
function renderFkeys(){
  $("fkeys").innerHTML=FKEYS.map(([k,l],i)=>`<button class="fkey" data-f="${i}"><i>${k}</i><span>${l}</span></button>`).join("");
  $("fkeys").querySelectorAll("[data-f]").forEach(b=>b.onclick=()=>FKEYS[+b.dataset.f][2]());
}
document.addEventListener("keydown",e=>{
  if(VIEW!=="sale"||document.querySelector(".veil"))return;
  const m=/^F([1-8])$/.exec(e.key);
  if(m){e.preventDefault();FKEYS[+m[1]-1][2]()}
});
function keyBloom(e){
  const b=e.target.closest(".key");if(!b)return;
  const r=b.getBoundingClientRect();
  b.style.setProperty("--px",((e.clientX-r.left)/r.width*100)+"%");
  b.style.setProperty("--py",((e.clientY-r.top)/r.height*100)+"%");
  b.classList.remove("hit");void b.offsetWidth;b.classList.add("hit");
}
function drawMenus(){
  $("menutabs").innerHTML=CFG.menus.map((m,i)=>
    `<button class="mtab ${i===MENU&&!FILTER?"on":""}" data-i="${i}">${esc(m.n)}</button>`).join("");
  $("menutabs").onclick=e=>{const b=e.target.closest(".mtab");
    if(b){MENU=+b.dataset.i;FILTER="";$("search").value="";drawMenus();drawGrid()}};
}
function timeBlocked(p){
  const r=byId(CFG.restricts,p.restrictId);
  if(!r||!r.start||!r.end)return null;
  const d=new Date(),t=d.getHours()*60+d.getMinutes();
  const[sh,sm]=r.start.split(":").map(Number),[eh,em]=r.end.split(":").map(Number);
  const s=sh*60+sm,e=eh*60+em;
  return (s<e?(t>=s&&t<e):(t>=s||t<e))?r:null;
}
function promoFor(p){return (CFG.promos||[]).find(x=>x.on&&x.pluIds.includes(p.id))}
function drawGrid(){
  let keys;
  if(FILTER){const q=FILTER.toLowerCase();
    keys=CFG.plus.filter(p=>p.n.toLowerCase().includes(q)||(p.upc||"").includes(q)).map(p=>({pluId:p.id}))}
  else keys=(CFG.menus[MENU]||{}).keys||[];
  drawMenus();
  if(!keys.length){$("grid").innerHTML=`<div class="empty" style="grid-column:1/-1">
    <svg viewBox="0 0 24 24">${ICONS.search}</svg><br>
    ${FILTER?`Nothing matches “${esc(FILTER)}”.<br>Ring it on the keypad, or add it under Config.`:"This menu has no keys yet.<br>Add some under Config → Menus."}</div>`;return}
  window.__k=i=>{const k=keys[i];k.pump?prepay(k):ring(byId(CFG.plus,k.pluId))};
  const style=(typeof THEME!=="undefined"&&THEME.keyStyle)||"tile";
  $("grid").className="grid ks-"+style;
  $("grid").innerHTML=keys.map((k,i)=>{
    const dly=`animation-delay:${Math.min(i*13,230)}ms`;
    if(k.pump)return`<button class="key pump" style="${dly}" onclick="__k(${i})">
      <span class="kn">${esc(k.label)}</span><span class="kp">Prepay</span></button>`;
    const p=byId(CFG.plus,k.pluId);if(!p)return"";
    const d=byId(CFG.depts,p.deptId),r=byId(CFG.restricts,p.restrictId),pr=promoFor(p),bl=timeBlocked(p);
    const col=k.color||d?.color||"#3E464A",f=[];
    if(r?.minAge)f.push(r.minAge+"+");
    if(p.weighed)f.push("per lb");
    if(p.ebt)f.push("EBT");
    if(p.deposit)f.push("+"+money(p.deposit)+" dep");
    const price=money(p.price)+(p.weighed?" /lb":"");
    const label=k.label||p.n;
    /* A key can occupy two columns or two rows, so the things sold all day are
       the easiest to hit. */
    const span=`${(k.w||1)>1?"grid-column:span 2;":""}${(k.h||1)>1?"grid-row:span 2;":""}`;
    const flags=`${f.length?`<span class="flag">${esc(f.join(" · "))}</span>`:""}${
      p.modIds?.length?`<span class="flag mod">options</span>`:""}${
      pr?`<span class="flag pr">${pr.qty} for ${money(pr.price)}</span>`:""}${
      bl?`<span class="flag pr">blocked now</span>`:""}`;
    const cls=`key ${bl?"blocked":""}`;

    /* Four genuinely different renderings of the same product. */
    if(style==="list")return`<button class="${cls}" onclick="__k(${i})" style="${dly}">
      <span class="swatch" style="background:${col}"></span>
      <span class="kn">${esc(label)}</span>
      <span class="kmeta">${flags}</span>
      <span class="kp num">${price}</span></button>`;
    if(style==="pad")return`<button class="${cls}" onclick="__k(${i})" style="${dly};${span}${keyBg(col)}">
      <span class="kn">${esc(label)}</span>
      <span class="kp num">${price}</span>${flags}</button>`;
    if(style==="card")return`<button class="${cls}" onclick="__k(${i})" style="${dly};${span}">
      <span class="kswatch" style="background:${col}"></span>
      <span class="kbody"><span class="kn">${esc(label)}</span>${flags}</span>
      <span class="kfoot"><span class="kp num">${price}</span><span class="kgo">Add</span></span></button>`;
    return`<button class="${cls}" onclick="__k(${i})" style="${dly};${span}${keyBg(col)}">
      <span class="swatch" style="background:${col};filter:brightness(1.7)"></span>
      <span class="kn">${esc(label)}</span>
      <span><span class="kp num">${price}</span>${flags}</span></button>`;
  }).join("");
}

/* ring pipeline: time block -> weight -> modifiers -> age -> line */
function ring(p){
  if(!p)return;
  const bl=timeBlocked(p);
  if(bl)return alertCard("Sale not allowed",`${p.n} can't be sold right now. ${bl.n}.`);
  if(p.weighed)return ask({t:"Weigh item",p:`Pounds of ${p.n} at $${money(p.price)}/lb.`,num:"1.00",
    done:v=>mods(p,{price:p.price*(+v),note:`${(+v).toFixed(2)} lb @ ${money(p.price)}/lb`})});
  mods(p,{});
}
function mods(p,ex){
  const gs=(p.modIds||[]).map(id=>byId(CFG.modGroups,id)).filter(Boolean);
  if(!gs.length)return ageGate(p,ex);
  const pick={};gs.forEach(g=>pick[g.id]=[]);
  const el=veil(`<div class="card tall" style="max-width:520px"><h3>${esc(p.n)}</h3>
    <p>Base ${money(p.price)}. Options adjust the line price.</p>
    <div class="edwrap" id="mgBody"></div>
    <div class="chg"><span>Line total</span><b id="mgTot">${money(p.price)}</b></div>
    <div class="row"><button class="no" id="mgn">Cancel</button><button class="ok" id="mgy">Add to sale</button></div></div>`);
  const total=()=>p.price+gs.reduce((s,g)=>s+pick[g.id].reduce((t,i)=>t+(g.opts[i].p||0),0),0);
  const paint=()=>{
    $("mgBody").innerHTML=gs.map((g,gi)=>`<div class="modgrp">
      <div class="mgh"><b>${esc(g.n)}</b><i class="${g.required?"req":""}">${g.required?"required":"optional"}${g.multi?" · pick any":""}</i></div>
      <div class="modopts">${g.opts.map((o,oi)=>`<button class="modopt ${pick[g.id].includes(oi)?"on":""}" data-g="${gi}" data-o="${oi}">
        ${esc(o.n)}${o.p?`<em>+${money(o.p)}</em>`:`<em>included</em>`}</button>`).join("")}</div></div>`).join("");
    $("mgTot").textContent=money(total());
    $("mgBody").querySelectorAll("[data-g]").forEach(b=>b.onclick=()=>{
      const g=gs[+b.dataset.g],oi=+b.dataset.o,arr=pick[g.id],at=arr.indexOf(oi);
      if(g.multi){at<0?arr.push(oi):arr.splice(at,1)}else pick[g.id]=at<0?[oi]:[];
      paint()});
  };
  paint();
  el.querySelector("#mgn").onclick=()=>el.remove();
  el.querySelector("#mgy").onclick=()=>{
    const missing=gs.find(g=>g.required&&!pick[g.id].length);
    if(missing)return toastCard(el,`Choose a ${missing.n.toLowerCase()} first.`);
    const chosen=gs.flatMap(g=>pick[g.id].map(i=>g.opts[i].n));
    el.remove();
    ageGate(p,{...ex,price:total()+(ex.price?ex.price-p.price:0),mods:chosen});
  };
}
function toastCard(el,msg){
  let t=el.querySelector(".mgwarn");
  if(!t){t=document.createElement("p");t.className="mgwarn";t.style.cssText="color:var(--warn);margin-top:9px";
    el.querySelector(".card").insertBefore(t,el.querySelector(".row"))}
  t.textContent=msg;
}
function ageGate(p,ex){
  const r=byId(CFG.restricts,p.restrictId);
  if(r?.minAge)return ask({t:"Check ID",p:`${p.n} is ${r.minAge}+. ${r.idScan?"Scan or confirm":"Confirm"} the date of birth on a valid, unexpired ID.`,
    yes:"Verified",no:"Refuse sale",done:()=>add(p,{...ex,note:[ex.note,`ID verified · ${r.minAge}+`].filter(Boolean).join(" · ")})});
  add(p,ex);
}
function add(p,ex={}){
  const line={lid:uid(),pluId:p.id,n:p.n,price:ex.price??p.price,q:1,deptId:p.deptId,
    taxId:byId(CFG.depts,p.deptId)?.taxId,ebt:p.ebt,note:ex.note||null,mods:ex.mods||null,disc:0};
  const m=CART.find(c=>c.pluId===p.id&&!c.note&&!c.mods&&!c.disc&&!ex.note&&!ex.mods);
  if(m){m.q++;FRESH=m.lid}else{CART.push(line);FRESH=line.lid}
  if(p.deposit)CART.push({lid:uid(),n:"Bottle deposit",price:p.deposit,q:1,taxId:"TX0",auto:true,disc:0});
  SEL=null;refreshSale();$("lines").scrollTop=$("lines").scrollHeight;
}
function prepay(k){
  ask({t:"Prepay fuel",p:`How much on ${k.label}?`,num:"30.00",pre:["10","20","30","40","50"],
    done:v=>{CART.push({lid:uid(),n:k.label+" prepay",price:+v,q:1,taxId:"TX0",deptId:"DF",
      note:`Authorize pump to $${money(+v)}`,disc:0});SEL=null;refreshSale()}});
}

/* ========================= totals ========================= */
function calc(){
  let promoOff=0;
  const qty={};CART.forEach(c=>{if(c.pluId)qty[c.pluId]=(qty[c.pluId]||0)+c.q});
  (CFG.promos||[]).filter(p=>p.on&&p.kind==="mixmatch").forEach(pr=>{
    let n=0,unit=[];
    pr.pluIds.forEach(id=>{const plu=byId(CFG.plus,id);
      if(qty[id]){n+=qty[id];for(let i=0;i<qty[id];i++)unit.push(plu.price)}});
    const sets=Math.floor(n/pr.qty);
    if(sets>0){unit.sort((a,b)=>b-a);
      promoOff+=Math.max(0,unit.slice(0,sets*pr.qty).reduce((s,v)=>s+v,0)-sets*pr.price)}
  });
  let sub=0;CART.forEach(c=>sub+=c.price*c.q*(1-(c.disc||0)/100));
  const afterPromo=Math.max(0,sub-promoOff);
  let disc=0;
  if(DISC)disc=DISC.type==="pct"?afterPromo*DISC.v/100:Math.min(DISC.v,afterPromo);
  const net=afterPromo-disc,ratio=sub?net/sub:1,taxes={};
  CART.forEach(c=>{const tr=byId(CFG.taxRates,c.taxId);if(!tr||!tr.rate)return;
    taxes[tr.id]=(taxes[tr.id]||0)+c.price*c.q*(1-(c.disc||0)/100)*ratio*tr.rate/100});
  const taxTotal=Object.values(taxes).reduce((s,v)=>s+v,0),sign=RETURN?-1:1;
  return{sub:sub*sign,promoOff:promoOff*sign,disc:disc*sign,taxes,taxTotal:taxTotal*sign,tot:(net+taxTotal)*sign};
}
const roundNickel=n=>Math.round(n*20)/20;
let TOTANIM=null,TOTVAL=0;
function setTotal(v){
  const el=$("tTot");
  if(TOTANIM)cancelAnimationFrame(TOTANIM);
  if(matchMedia("(prefers-reduced-motion: reduce)").matches||Math.abs(v-TOTVAL)<0.005){
    TOTVAL=v;el.textContent=money(v);return}
  const from=TOTVAL,t0=performance.now();
  el.classList.add("tick");
  const step=now=>{const k=Math.min(1,(now-t0)/260),e=1-Math.pow(1-k,3);
    el.textContent=money(from+(v-from)*e);
    if(k<1)TOTANIM=requestAnimationFrame(step);
    else{TOTVAL=v;el.textContent=money(v);el.classList.remove("tick")}};
  TOTANIM=requestAnimationFrame(step);
}
/* Two shells now render the same sale. Everything that changes the cart calls
   this instead of assuming the panel-and-grid layout is on screen. */
const SHELLS={classic:()=>drawClassic(),menu:()=>drawMenuShell(),
  commerce:()=>drawCommerceShell(),board:()=>drawBoardShell(),kiosk:()=>drawKioskShell()};
function refreshSale(){
  const s=typeof THEME!=="undefined"&&THEME.shell;
  if(s&&SHELLS[s])return SHELLS[s]();
  drawCart();
}
function drawCart(){
  const s=typeof THEME!=="undefined"&&THEME.shell;
  if(s&&s!=="panels"&&SHELLS[s])return SHELLS[s]();
  const L=$("lines");
  if(!CART.length)L.innerHTML=`<div class="empty"><svg viewBox="0 0 24 24">${ICONS.cart}</svg><br>
    ${RETURN?"Return mode.<br>Ring the items coming back.":"No items yet.<br>Tap a key to start a sale."}</div>`;
  else{
    window.__sel=i=>{SEL=SEL===i?null:i;refreshSale()};
    window.__vx=(i,e)=>{e.stopPropagation();voidLine(i)};
    L.innerHTML=CART.map((c,i)=>{
      const eff=c.price*c.q*(1-(c.disc||0)/100);
      const plu=c.pluId?byId(CFG.plus,c.pluId):null,pr=plu?promoFor(plu):null;
      const notes=[c.note,c.disc?`${c.disc}% off`:null,pr?pr.n:null].filter(Boolean).join(" · ");
      return`<div class="line ${SEL===i?"sel":""} ${pr?"promo":""} ${c.lid===FRESH?"fresh":""}" onclick="__sel(${i})">
        <span class="qty num">${c.q}</span>
        <span class="nm">${esc(c.n)}
          ${c.mods?.length?`<small class="mod">${esc(c.mods.join(" · "))}</small>`:""}
          ${notes?`<small>${esc(notes)}</small>`:""}</span>
        <span class="amt num">${RETURN?"−":""}${money(eff)}</span>
        <button class="x" onclick="__vx(${i},event)" aria-label="Void ${esc(c.n)}">×</button></div>`}).join("");
  }
  $("lineOps").innerHTML=SEL!=null&&CART[SEL]&&!CART[SEL].auto
    ?`<div class="lineops"><button id="lm">− qty</button><button id="lp">+ qty</button>
      <button id="lpr">Price</button><button id="ld">Discount</button><button id="lv">Void</button></div>`:"";
  if(SEL!=null&&$("lm")){
    $("lm").onclick=()=>{const c=CART[SEL];c.q>1?c.q--:voidLine(SEL);refreshSale()};
    $("lp").onclick=()=>{CART[SEL].q++;refreshSale()};
    $("lpr").onclick=()=>auth("pricechange","Price override",()=>ask({t:"Override price",
      p:`New unit price for ${CART[SEL].n}.`,num:money(CART[SEL].price),
      done:v=>{CART[SEL].price=+v;CART[SEL].note="price overridden";refreshSale()}}));
    $("ld").onclick=()=>auth("discount","Line discount",()=>ask({t:"Line discount",
      p:`Percent off ${CART[SEL].n}.`,num:"10",done:v=>{CART[SEL].disc=Math.min(100,+v);refreshSale()}}));
    $("lv").onclick=()=>voidLine(SEL);
  }
  const t=calc();
  $("tSub").textContent=money(t.sub);
  $("promoRow").style.display=Math.abs(t.promoOff)>0.001?"flex":"none";
  $("tPromo").textContent="−"+money(Math.abs(t.promoOff));
  $("discRow").style.display=DISC?"flex":"none";
  if(DISC){$("discLabel").textContent=`Discount (${DISC.type==="pct"?DISC.v+"%":"$"+money(DISC.v)})`;
    $("tDisc").textContent="−"+money(Math.abs(t.disc))}
  $("taxRows").innerHTML=CFG.taxRates.filter(r=>r.rate>0).map(r=>
    `<div class="trow"><span>${esc(r.n)} ${r.rate}%</span><span class="num">${money((t.taxes[r.id]||0)*(RETURN?-1:1))}</span></div>`).join("");
  $("grandLabel").textContent=RETURN?"Refund due":"Total";
  setTotal(t.tot);FRESH=null;
  $("tapePill").innerHTML=RETURN
    ?`<span class="pill ret">${RETREF?`Return · #${RETREF.n}`:"Return · no receipt"}</span>`
    :TRAIN?`<span class="pill train">Training</span>`:"";
  document.querySelectorAll(".tender").forEach(b=>{
    const m=byId(CFG.mops,b.dataset.m);
    const needsNet=m&&!m.change&&m.kind!=="house"&&m.kind!=="check";
    b.disabled=!CART.length||(needsNet&&typeof ONLINE!=="undefined"&&!ONLINE);
    b.title=b.disabled&&CART.length?"Card payments need the network — take cash while offline":"";
  });
}
function voidLine(i){
  const c=CART[i];if(!c)return;
  auth("void","Voiding a line",()=>reasonPrompt("void",`Void ${c.n}`,r=>{
    SHIFT.exceptions.push({at:new Date(),by:ME.n,what:`Void ${c.n}`,reason:r?.n});
    CART.splice(i,1);SEL=null;refreshSale();toast(`Voided <b>${esc(c.n)}</b>${r?` · ${esc(r.n)}`:""}`)}));
}

/* ========================= prompts ========================= */
function alertCard(t,p){const el=veil(`<div class="card"><h3>${esc(t)}</h3><p>${esc(p)}</p>
  <div class="row"><button class="no" id="an">OK</button></div></div>`);
  el.querySelector("#an").onclick=()=>el.remove()}
function ask(o){
  const el=veil(`<div class="card"><h3>${esc(o.t)}</h3><p>${esc(o.p)}</p>
    ${o.num!==undefined?`<input id="pv" class="big num" value="${esc(o.num)}" inputmode="decimal">`:""}
    ${o.pre?`<div class="opts">${o.pre.map(v=>`<button data-pre="${esc(v)}">$${esc(v)}</button>`).join("")}</div>`:""}
    <div class="row"><button class="${o.no?"danger":"no"}" id="pn">${esc(o.no||"Cancel")}</button>
      <button class="ok" id="py">${esc(o.yes||"Add to sale")}</button></div></div>`);
  el.querySelector("#pn").onclick=()=>el.remove();
  o.pre&&el.querySelectorAll("[data-pre]").forEach(b=>b.onclick=()=>el.querySelector("#pv").value=b.dataset.pre);
  const y=el.querySelector("#py");
  y.onclick=()=>{const v=o.num!==undefined?parseFloat(el.querySelector("#pv").value):1;
    if(o.num!==undefined&&!(v>0))return;el.remove();o.done&&o.done(v)};
  if(o.num!==undefined){const i=el.querySelector("#pv");i.focus();i.select();
    i.onkeydown=e=>{if(e.key==="Enter")y.click()}}
}
function priceCheck(){
  const el=veil(`<div class="card"><h3>Price check</h3><p>Scan or type a barcode. Nothing is added to the sale.</p>
    <input id="pcv" class="big num" placeholder="UPC" style="text-align:left;font-size:17px">
    <div id="pcr" style="margin-top:14px"></div>
    <div class="row"><button class="no" id="pcn">Close</button></div></div>`);
  const inp=el.querySelector("#pcv");inp.focus();
  inp.oninput=()=>{
    const p=CFG.plus.find(x=>x.upc===inp.value.trim())
      ||CFG.plus.find(x=>x.n.toLowerCase().includes(inp.value.trim().toLowerCase())&&inp.value.trim().length>2);
    el.querySelector("#pcr").innerHTML=p?`<div class="chg"><span>${esc(p.n)}<br>
      <span style="font-size:11.5px;color:var(--txt-3)">${esc(byId(CFG.depts,p.deptId)?.n||"")}</span></span>
      <b>${money(p.price)}</b></div>`:inp.value.trim()?`<p style="color:var(--txt-3)">No match yet.</p>`:"";
  };
  el.querySelector("#pcn").onclick=()=>el.remove();
}
function discPrompt(){
  if(!CART.length)return;
  const el=veil(`<div class="card"><h3>Discount the sale</h3><p>Applied after automatic promotions, before tax.</p>
    <div class="opts">${[5,10,15,20,25].map(v=>`<button data-p="${v}">${v}%</button>`).join("")}<button data-p="0">Remove</button></div>
    <input id="dv" class="big num" value="5.00" inputmode="decimal">
    <div class="row"><button class="no" id="dn">Cancel</button><button class="ok" id="dy">Dollars off</button></div></div>`);
  el.querySelector("#dn").onclick=()=>el.remove();
  el.querySelectorAll("[data-p]").forEach(b=>b.onclick=()=>{
    const v=+b.dataset.p;DISC=v?{type:"pct",v}:null;el.remove();refreshSale()});
  el.querySelector("#dy").onclick=()=>{const v=parseFloat(el.querySelector("#dv").value);
    if(!(v>0))return;DISC={type:"amt",v};el.remove();refreshSale()};
}
/* A return should start from the original sale, not from an empty basket. It
   puts the money back on the card it came off, it caps the refund at what was
   actually paid, and it makes "I bought this here" checkable instead of taken
   on trust — which is most of retail refund fraud closed off for one extra tap. */
function toggleReturn(){
  if(RETURN){RETURN=false;RETREF=null;CART=[];DISC=null;refreshSale();
    return toast("Back to normal sales.")}
  findOriginal();
}
function findOriginal(){
  const recent=SHIFT.sales.filter(s=>!s.ret).slice().reverse().slice(0,20);
  const el=veil(`<div class="card tall"><h3>Find the original sale</h3>
    <p>Refunds go back to the card the customer paid with, so we need the transaction it came from.
      Scan the barcode on their receipt, type the number, or pick it from today.</p>
    <input id="rfq" class="big num" placeholder="Receipt #" inputmode="numeric">
    <div class="edwrap" style="max-height:34vh">
      <div class="opts" style="flex-direction:column">${recent.map(s=>{
        const card=s.pays.find(p=>p.intent);
        return `<button data-n="${s.n}" style="width:100%;display:flex;justify-content:space-between;gap:10px">
          <span>#${s.n} · ${esc(s.by||"")}${card?` · ${esc(card.brand||"card")} ****${esc(card.last4||"")}`:" · cash"}</span>
          <span class="num">${money(Math.abs(s.tot))} · ${s.at.toLocaleTimeString()}</span></button>`}).join("")
        ||`<p style="color:var(--txt-3);font-size:13px">Nothing sold yet on this shift.</p>`}</div></div>
    <div class="row"><button class="no" id="rfn">Cancel</button>
      <button class="no" id="rfnone">No receipt</button></div></div>`);
  const pick=s=>{
    el.remove();RETURN=true;RETREF=s;
    /* Load what they bought, then let the cashier strike out anything being kept. */
    CART=s?JSON.parse(JSON.stringify(s.lines)):[];
    CART.forEach(c=>c.lid=uid());
    DISC=null;SEL=null;refreshSale();
    toast(s?`Return against <b>#${s.n}</b>. Void anything they're keeping, then pick a refund method.`
           :"Return with no receipt. Card refunds aren't available — cash only.");
  };
  el.querySelector("#rfn").onclick=()=>el.remove();
  el.querySelector("#rfnone").onclick=()=>pick(null);
  el.querySelectorAll("[data-n]").forEach(b=>b.onclick=()=>pick(SHIFT.sales.find(s=>s.n===+b.dataset.n)));
  const inp=el.querySelector("#rfq");inp.focus();
  inp.onkeydown=e=>{
    if(e.key!=="Enter")return;
    const s=SHIFT.sales.find(x=>x.n===parseInt(inp.value));
    if(s)pick(s);else{inp.value="";inp.placeholder="No sale with that number"}
  };
}
function noSale(){auth("nosale","Opening the drawer",()=>reasonPrompt("nosale","No sale",r=>{
  SHIFT.noSales++;SHIFT.exceptions.push({at:new Date(),by:ME.n,what:"No sale",reason:r?.n});
  if(typeof kickDrawer==="function")kickDrawer();
  toast(`Drawer opened, no sale${r?` · ${esc(r.n)}`:""}. Logged to the shift.`)}))}
function payOut(){reasonPrompt("payout","Pay out",r=>ask({t:"Pay out",
  p:"Cash removed from the drawer. Reduces what the drawer should hold at close.",num:"20.00",
  done:v=>{SHIFT.paidOut+=+v;SHIFT.exceptions.push({at:new Date(),by:ME.n,what:`Pay out ${money(+v)}`,reason:r?.n});
    toast(`Paid out <b>${money(+v)}</b>${r?` · ${esc(r.n)}`:""}`)}}))}
function payIn(){ask({t:"Pay in",p:"Cash added to the drawer from outside a sale.",num:"20.00",
  done:v=>{SHIFT.paidIn+=+v;toast(`Paid in <b>${money(+v)}</b>`)}})}
function safeDrop(){ask({t:"Safe drop",p:"Cash moved from the drawer to the safe.",num:"100.00",
  done:v=>{SHIFT.safeDrops+=+v;toast(`Safe drop <b>${money(+v)}</b> recorded.`)}})}
function hold(){
  if(!CART.length)return;
  if(typeof modOn==="function"&&modOn("service"))return holdNamed();
  HELD.push({lines:CART,disc:DISC,at:new Date(),n:HELD.length+1,by:ME.n});
  CART=[];SEL=null;DISC=null;refreshSale();renderSubops();toast(`Sale suspended. ${HELD.length} on hold.`)}
function holdNamed(){
  const el=veil(`<div class="card"><h3>Open a tab</h3>
    <p>A table number or a name, so it can be found again.</p>
    <input id="tbn" class="big" style="text-align:left;font-size:19px" placeholder="Table 6">
    <div class="row"><button class="no" id="tbc">Cancel</button>
      <button class="ok" id="tbo">Open it</button></div></div>`);
  const inp=el.querySelector("#tbn");inp.focus();
  const go=()=>{
    const label=inp.value.trim()||("#"+(HELD.length+1));
    HELD.push({lines:CART,disc:DISC,at:new Date(),n:HELD.length+1,by:ME.n,label});
    CART=[];SEL=null;DISC=null;el.remove();refreshSale();renderSubops();
    toast(`Tab <b>${esc(label)}</b> opened. ${HELD.length} running.`);
  };
  el.querySelector("#tbc").onclick=()=>el.remove();
  el.querySelector("#tbo").onclick=go;
  inp.onkeydown=e=>{if(e.key==="Enter")go()};
}
function recall(){
  if(!HELD.length)return toast("Nothing on hold.");
  const el=veil(`<div class="card"><h3>Suspended sales</h3><p>Pick one to bring back to the register.</p>
    <div class="opts" style="flex-direction:column">${HELD.map((h,i)=>{
      const n=h.lines.reduce((s,c)=>s+c.q,0),v=h.lines.reduce((s,c)=>s+c.price*c.q,0);
      return`<button data-i="${i}" style="width:100%">${esc(h.label||("#"+h.n))} · ${n} item${n===1?"":"s"} · $${money(v)} · ${h.by} · ${h.at.toLocaleTimeString()}</button>`}).join("")}</div>
    <div class="row"><button class="no" id="hn">Cancel</button></div></div>`);
  el.querySelector("#hn").onclick=()=>el.remove();
  el.querySelectorAll("[data-i]").forEach(b=>b.onclick=()=>{
    const h=HELD.splice(+b.dataset.i,1)[0];CART=h.lines;DISC=h.disc;el.remove();
    refreshSale();renderSubops();toast(`Recalled #${h.n}.`)});
}

/* ========================= tender ========================= */
/* Modules that reach into the sale hook here. Each one checks whether it is
   switched on first, so a shop that wants none of this sees none of it. */
async function tender(mop){
  const t=calc();let due=Math.abs(t.tot);
  if(!RETURN){
    if(typeof modOn==="function"&&modOn("giftcards")&&mop.kind==="gift"){
      const paid=await redeemGiftCard(due);
      if(paid===null)return;
      due=paid.remaining;
      if(due<=0.005)return finish([{mop:mop.n,amt:paid.used,card:paid.code}],0);
      PART_PAID=[{mop:mop.n,amt:paid.used,card:paid.code}];
    }
    if(typeof modOn==="function"&&modOn("customers")){
      const c=custCfg();
      if(c.ask==="ask"||(c.ask==="card"&&!mop.change))SALE_CUST=await askCustomer();
    }
    if(typeof modOn==="function"&&modOn("tips")&&!mop.change){
      SALE_TIP=await askTip(due);due+=SALE_TIP;
    }
  }
  if(RETURN)return auth("refund","Refund",()=>reasonPrompt("refund","Reason for return",r=>doRefund(mop,due,r)));
  if(mop.ebtOnly){
    const el=CART.filter(c=>c.ebt).reduce((s,c)=>s+c.price*c.q,0);
    if(el<=0)return alertCard("Nothing EBT-eligible","No item in this sale is flagged SNAP-eligible. Mark items under Config → Pricebook.");
    due=Math.min(due,el);
  }
  if(mop.rounds&&CFG.rounding.nickel)due=roundNickel(due);
  if(!mop.change){
    /* Card, EBT and anything else settled on a reader. The sale is only written
       once the reader approves, and the money is only captured after that. */
    const cid=Date.now().toString(36)+Math.random().toString(36).slice(2,8);
    cardPayment(mop,due,cid).then(r=>{
      if(!r)return;
      finish([{mop:mop.n,amt:due,intent:r.intent||null,
        brand:r.brand||null,last4:r.last4||null}],0,null,cid);
    });
    return;
  }
  const rd=CFG.rounding.nickel?roundNickel(due):due;
  const quick=[rd,Math.ceil(rd),Math.ceil(rd/5)*5,Math.ceil(rd/10)*10,Math.ceil(rd/20)*20]
    .filter((v,i,a)=>v>0&&a.indexOf(v)===i).slice(0,5);
  const el=veil(`<div class="card"><h3>${esc(mop.n)}</h3>
    <p>Amount due ${money(rd)}.${CFG.rounding.nickel&&Math.abs(rd-due)>0.001?` Rounded to the nickel from ${money(due)}.`:""}</p>
    <input id="cv" class="big num" value="${money(rd)}" inputmode="decimal">
    <div class="opts">${quick.map(v=>`<button data-c="${v}">${Math.abs(v-rd)<0.001?"Exact":"$"+money(v)}</button>`).join("")}</div>
    <div class="chg"><span>Change due</span><b id="chg">0.00</b></div>
    <div class="row"><button class="no" id="cn">Cancel</button><button class="ok" id="cy">Complete sale</button></div>
    <div class="row"><button class="no" id="cs" style="font-size:13px">Split with card</button></div></div>`);
  const inp=el.querySelector("#cv"),out=el.querySelector("#chg");
  const upd=()=>out.textContent=money(Math.max(0,(parseFloat(inp.value)||0)-rd));
  inp.oninput=upd;upd();inp.focus();inp.select();
  el.querySelectorAll("[data-c]").forEach(b=>b.onclick=()=>{inp.value=money(+b.dataset.c);upd()});
  el.querySelector("#cn").onclick=()=>el.remove();
  el.querySelector("#cy").onclick=()=>{const g=parseFloat(inp.value)||0;if(g<rd-0.001)return;
    el.remove();finish([{mop:mop.n,amt:rd,given:g,change:g-rd}],rd-due)};
  el.querySelector("#cs").onclick=()=>{const g=parseFloat(inp.value)||0;if(!(g>0)||g>=rd)return;
    el.remove();finish([{mop:mop.n,amt:g},{mop:"Credit",amt:rd-g}],rd-due)};
}
/* Card refunds go against the original PaymentIntent — the customer doesn't
   re-present the card, because Stripe returns it to whatever they paid with.
   Without an original there is nothing to refund to, so it's cash or nothing. */
async function doRefund(mop,due,reason){
  const orig=RETREF&&RETREF.pays?RETREF.pays.find(p=>p.intent):null;

  if(mop.change||mop.kind==="cash"){
    if(RETREF){
      const paidCash=RETREF.pays.filter(p=>!p.intent).reduce((s,p)=>s+Math.abs(p.amt),0);
      if(paidCash<due-0.001&&orig)
        return confirmCard(`They paid ${money(Math.abs(orig.amt))} by card. Refunding cash instead is
          how card refunds get laundered — most stores don't allow it. Refund to the card instead?`,
          ()=>doRefund(CFG.mops.find(m=>!m.change)||mop,due,reason),
          ()=>finishRefund([{mop:mop.n,amt:-due}],reason));
    }
    if(typeof kickDrawer==="function")kickDrawer();
    return finishRefund([{mop:mop.n,amt:-due}],reason);
  }

  if(!orig){
    return alertCard("No card to refund",
      `This return isn't linked to a card sale, so there's nothing to put the money back on. `
      +`Refund it as cash, or start the return again and find the original receipt.`);
  }
  const cap=Math.abs(orig.amt);
  if(due>cap+0.001)
    return alertCard("More than they paid",
      `That card was charged ${money(cap)}. You can't refund ${money(due)} against it.`);

  const el=veil(`<div class="card"><h3>Refund to card</h3>
    <p>Going back to the ${esc(orig.brand||"card")} ending ${esc(orig.last4||"????")} from sale
      #${RETREF.n}. The customer doesn't need to present it — it returns to whatever they paid with,
      usually within a few business days.</p>
    <div class="chg"><span>Refund</span><b>${money(due)}</b></div>
    <div class="paystate" id="rfState"><span class="spin"></span><span id="rfStep">Sending to Stripe</span></div>
    <div class="row"><button class="no" id="rfc">Cancel</button></div></div>`);
  try{
    const r=await api("/api/pay/refund?store="+STORE_ID,{method:"POST",
      body:{store:STORE_ID,intent:orig.intent,amount:due}});
    el.querySelector("#rfStep").textContent="Refunded";
    el.querySelector("#rfStep").className="ok";
    setTimeout(()=>{el.remove();
      finishRefund([{mop:mop.n,amt:-due,intent:orig.intent,refund:r.refund,
        brand:orig.brand,last4:orig.last4}],reason)},900);
  }catch(e){
    el.querySelector("#rfStep").textContent=e.message||"Stripe refused the refund";
    el.querySelector("#rfStep").className="bad";
    el.querySelector("#rfc").textContent="Close";
  }
  el.querySelector("#rfc").onclick=()=>el.remove();
}
function confirmCard(msg,onCard,onCash){
  const el=veil(`<div class="card"><h3>Refund to the card instead?</h3><p>${esc(msg)}</p>
    <div class="row"><button class="no" id="ccash">Cash anyway</button>
      <button class="ok" id="ccard">Refund the card</button></div></div>`);
  el.querySelector("#ccash").onclick=()=>{el.remove();onCash()};
  el.querySelector("#ccard").onclick=()=>{el.remove();onCard()};
}
function finishRefund(pays,reason){
  const t=calc();
  finish(pays,0,reason);
  RETREF=null;
}

function redeemGiftCard(due){
  const c=gcCfg();
  return new Promise(res=>{
    const el=veil(`<div class="card"><h3>Gift card</h3>
      <p>Enter or scan the card number. ${money(due)} to pay.</p>
      <input id="gcv" class="big num" placeholder="card number">
      <div id="gcr" style="margin-top:12px"></div>
      <div class="row"><button class="no" id="gcn">Cancel</button>
        <button class="ok" id="gcy">Use it</button></div></div>`);
    const inp=el.querySelector("#gcv"),out=el.querySelector("#gcr");
    let card=null;
    inp.oninput=()=>{
      card=c.cards.find(x=>x.code===inp.value.trim());
      out.innerHTML=card
        ?`<div class="chg"><span>Balance</span><b>${money(card.bal)}</b></div>`
        :inp.value.trim().length>5?`<p style="color:var(--void);font-size:13px">No card with that number.</p>`:"";
    };
    inp.focus();
    el.querySelector("#gcn").onclick=()=>{el.remove();res(null)};
    el.querySelector("#gcy").onclick=()=>{
      if(!card||card.bal<=0.005)return;
      const used=Math.min(card.bal,due);
      card.bal=+(card.bal-used).toFixed(2);
      setModule("giftcards",true,c);queueSave();
      el.remove();res({used,remaining:+(due-used).toFixed(2),code:card.code});
    };
  });
}

function finish(pays,roundAdj,reason,cid){
  if(PART_PAID){pays=PART_PAID.concat(pays);PART_PAID=null}
  const t=calc();
  const sale={n:SHIFT.num++,at:new Date(),by:ME.n,lines:JSON.parse(JSON.stringify(CART)),...t,pays,
    ret:RETURN,manualDisc:DISC,roundAdj:roundAdj||0,reason:reason?.n,train:TRAIN,
    against:RETREF?RETREF.n:null,
    tip:SALE_TIP||0,customer:SALE_CUST||null,
    cid:cid||(Date.now().toString(36)+Math.random().toString(36).slice(2,8))};
  if(!TRAIN)SHIFT.sales.push(sale);
  CART=[];SEL=null;DISC=null;SALE_TIP=0;SALE_CUST=null;
  const wasRet=RETURN;RETURN=false;RETREF=null;refreshSale();
  const paid=pays.map(p=>`${p.mop} ${money(Math.abs(p.amt))}`).join(" + ");
  const ch=pays.find(p=>p.change>0.001);
  /* Record first, then take the money. If anything fails between the two, the
     authorisation expires on its own — far better than a charge with no sale. */
  const held=pays.find(p=>p.intent);
  if(held&&!TRAIN)capturePayment(held.intent);
  if(typeof printReceipt==="function"&&!RETURN)
    printReceipt(sale,{kick:pays.some(p=>{const m=CFG.mops.find(x=>x.n===p.mop);return m&&m.drawer})});
  /* A shell can take over what happens after a sale. Menu shows a ticket
     number rather than a receipt, because that's what a café hands over. */
  if(typeof THEME!=="undefined"&&THEME.shell==="menu"&&typeof mnFinished==="function"){
    mnFinished(sale);
    if(typeof printReceipt==="function"&&!wasRet)printReceipt(sale,{kick:pays.some(p=>{
      const m=CFG.mops.find(x=>x.n===p.mop);return m&&m.drawer})});
    return;
  }
  window.__rcpt=n=>receipt(SHIFT.sales.find(s=>s.n===n)||sale);
  toast(`${wasRet?"Refunded":"Paid"} <b>${money(Math.abs(t.tot))}</b> · ${esc(paid)}${ch?` · change <b>${money(ch.change)}</b>`:""}
    &nbsp;<button class="act" onclick="__rcpt(${sale.n})">Receipt</button>`);
  receipt(sale);
}
function receipt(s){
  if(!s)return;
  const ln=s.lines.map(c=>{
    const eff=c.price*c.q*(1-(c.disc||0)/100);
    return`<div class="rr"><span>${c.q>1?c.q+" × ":""}${esc(c.n)}</span><span>${s.ret?"−":""}${money(eff)}</span></div>`
      +(c.mods?.length?`<div style="color:#6E6F6A;padding-left:10px">${esc(c.mods.join(", "))}</div>`:"")
      +(c.note?`<div style="color:#6E6F6A;padding-left:10px">${esc(c.note)}</div>`:"")}).join("");
  const el=veil(`<div class="card"><div class="receipt">
    <div class="ctr big">${esc(CFG.site.name)}</div>
    <div class="ctr">${esc(CFG.site.addr)}</div><div class="ctr">${esc(CFG.site.tagline)}</div><hr>
    ${s.train?`<div class="ctr big">** TRAINING — NOT A SALE **</div><hr>`:""}
    <div class="rr"><span>Store ${esc(CFG.site.store)} Reg ${esc(CFG.site.register)}</span><span>Trans #${s.n}</span></div>
    <div class="rr"><span>${s.at.toLocaleString()}</span><span>${s.ret?"REFUND":"SALE"}</span></div>
    <div class="rr"><span>Cashier ${esc(s.by||"")}</span><span></span></div><hr>
    ${ln}<hr>
    <div class="rr"><span>Subtotal</span><span>${money(s.sub)}</span></div>
    ${Math.abs(s.promoOff)>0.001?`<div class="rr"><span>Promotions</span><span>−${money(Math.abs(s.promoOff))}</span></div>`:""}
    ${s.manualDisc?`<div class="rr"><span>Discount</span><span>−${money(Math.abs(s.disc))}</span></div>`:""}
    ${CFG.taxRates.filter(r=>r.rate>0&&Math.abs(s.taxes[r.id]||0)>0.001).map(r=>
      `<div class="rr"><span>${esc(r.n)} ${r.rate}%</span><span>${money((s.taxes[r.id]||0)*(s.ret?-1:1))}</span></div>`).join("")}
    ${Math.abs(s.roundAdj)>0.001?`<div class="rr"><span>Cash rounding</span><span>${money(-s.roundAdj)}</span></div>`:""}
    <div class="rr big"><span>${s.ret?"REFUND":"TOTAL"}</span><span>${money(s.tot+(s.roundAdj||0))}</span></div><hr>
    ${s.pays.map(p=>`<div class="rr"><span>${esc(p.mop)}${
      p.brand?` ${esc(p.brand)} ****${esc(p.last4||"")}`:""}${p.refund?" refund":""}</span><span>${money(Math.abs(p.amt))}</span></div>`
      +(p.change>0.001?`<div class="rr"><span>Change</span><span>${money(p.change)}</span></div>`:"")).join("")}
    ${s.tip>0.005?`<div class="rr"><span>Tip</span><span>${money(s.tip)}</span></div>`:""}
    ${s.customer?`<hr><div class="ctr">${esc(s.customer.n||s.customer.phone||"")}${
      s.pointsEarned?` · ${s.pointsEarned} points`:""}</div>`:""}
    ${s.against?`<hr><div class="ctr">Refund against sale #${s.against}</div>`:""}
    ${s.reason?`<hr><div class="ctr">Reason: ${esc(s.reason)}</div>`:""}
    <hr><div class="ctr">${esc(CFG.receipt?.footer||"Thank you")}</div>
    ${CFG.receipt?.policy?`<div class="ctr" style="color:#6E6F6A">${esc(CFG.receipt.policy)}</div>`:""}</div>
    <div class="row"><button class="no" id="rn">Close</button><button class="ok" id="rp">Print</button></div></div>`);
  el.querySelector("#rn").onclick=()=>el.remove();
  el.querySelector("#rp").onclick=async()=>{el.remove();
    const how=await printReceipt(s,{});
    toast(how==="printed"?"Receipt printed."
      :how==="browser"?"Sent to the browser's printer — run the station agent for till roll and the drawer."
      :"Printing failed.")};
}
function wedge(){
  let buf="",last=0;
  document.addEventListener("keydown",e=>{
    if(VIEW!=="sale"||document.querySelector(".veil"))return;
    const now=Date.now();if(now-last>90)buf="";last=now;
    if(e.key==="Enter"&&buf.length>=6){
      const p=CFG.plus.find(x=>x.upc===buf);
      if(p){ring(p);toast(`Scanned <b>${esc(buf)}</b> · ${esc(p.n)}`)}
      else toast(`No PLU matches <b>${esc(buf)}</b>. Add it under Config, or use the keypad.`,true);
      buf="";e.preventDefault();return}
    if(/^[0-9]$/.test(e.key))buf+=e.key;
  });
}

/* ========================= back office ========================= */
function shiftStats(){
  const S=SHIFT.sales,g=f=>S.reduce((a,x)=>a+f(x),0);
  const byMop={};S.forEach(x=>x.pays.forEach(p=>byMop[p.mop]=(byMop[p.mop]||0)+p.amt));
  const byDept={};S.forEach(x=>x.lines.forEach(c=>{const d=byId(CFG.depts,c.deptId);if(!d)return;
    byDept[d.n]=(byDept[d.n]||0)+c.price*c.q*(1-(c.disc||0)/100)*(x.ret?-1:1)}));
  const byItem={};S.forEach(x=>x.lines.forEach(c=>{if(!c.pluId)return;
    byItem[c.n]=(byItem[c.n]||0)+c.q*(x.ret?-1:1)}));
  const byTax={};S.forEach(x=>Object.entries(x.taxes||{}).forEach(([k,v])=>byTax[k]=(byTax[k]||0)+v*(x.ret?-1:1)));
  const byHour=Array(24).fill(0);S.forEach(x=>byHour[x.at.getHours()]+=x.tot);
  const drawer=SHIFT.startCash+(byMop.Cash||0)+SHIFT.paidIn-SHIFT.paidOut-SHIFT.safeDrops;
  const net=g(x=>x.tot),cnt=S.filter(x=>!x.ret).length;
  return{S,g,byMop,byDept,byItem,byTax,byHour,drawer,net,cnt,avg:cnt?net/cnt:0};
}
function drawOffice(){
  const s=shiftStats(),d=new Date();
  const hrs=s.byHour.map((v,i)=>({v,i})).filter(x=>x.i>=5&&x.i<=23);
  const mx=Math.max(0.01,...hrs.map(x=>x.v));
  const dmax=Math.max(0.01,...Object.values(s.byDept));
  const top=Object.entries(s.byItem).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const tmax=Math.max(1,...top.map(t=>t[1]));
  window.__task=id=>{const t=byId(CFG.reminders,id);t.done=!t.done;drawOffice();clock()};
  $("vOffice").innerHTML=`<div class="pane">
    <h2>Back office</h2>
    <p class="lede">Live view of the open shift. Opened ${SHIFT.opened.toLocaleTimeString()} by ${esc(ME.n)}.</p>
    <div class="cards">
      <div class="stat" style="animation-delay:0ms"><div class="lbl">Net sales</div>
        <div class="val g num">${money(s.net)}</div><div class="sub2">${s.S.length} transaction${s.S.length===1?"":"s"}</div></div>
      <div class="stat" style="animation-delay:40ms"><div class="lbl">Average basket</div>
        <div class="val num">${money(s.avg)}</div><div class="sub2">${s.cnt} sale${s.cnt===1?"":"s"}, ${s.S.filter(x=>x.ret).length} return${s.S.filter(x=>x.ret).length===1?"":"s"}</div></div>
      <div class="stat" style="animation-delay:80ms"><div class="lbl">Expected in drawer</div>
        <div class="val num">${money(s.drawer)}</div><div class="sub2">opened with ${money(SHIFT.startCash)}</div></div>
      <div class="stat" style="animation-delay:120ms"><div class="lbl">Exceptions</div>
        <div class="val ${SHIFT.exceptions.length?"w":""} num">${SHIFT.exceptions.length}</div>
        <div class="sub2">${SHIFT.noSales} no sale${SHIFT.noSales===1?"":"s"}</div></div>
    </div>

    <div class="two">
      <div class="panel"><h3>Sales by hour</h3><div class="ph">Where the day's volume actually landed.</div>
        <div class="bars">${hrs.map((x,i)=>`<div class="b" style="height:${Math.max(2,x.v/mx*100)}%;animation-delay:${i*22}ms"
          title="${x.i}:00 — ${money(x.v)}"><span>${x.i%3===0?x.i:""}</span></div>`).join("")}</div>
        <div class="barsx"></div></div>
      <div class="panel"><h3>Department mix</h3><div class="ph">Which buckets the money came from.</div>
        ${Object.entries(s.byDept).length?Object.entries(s.byDept).sort((a,b)=>b[1]-a[1]).map(([k,v],i)=>{
          const dep=CFG.depts.find(x=>x.n===k);
          return`<div class="hbar"><span class="hn">${esc(k)}</span><span class="ht">
            <span class="hf" style="width:${Math.max(2,v/dmax*100)}%;background:${dep?.color||"var(--vfd-dim)"};
              filter:brightness(1.7);animation-delay:${i*60}ms"></span></span>
            <span class="hv">${money(v)}</span></div>`}).join("")
          :`<p style="color:var(--txt-3);font-size:13px">No sales yet this shift.</p>`}</div>
    </div>

    <div class="two">
      <div class="panel"><h3>Top movers</h3><div class="ph">Units sold this shift.</div>
        ${top.length?top.map(([k,v],i)=>`<div class="hbar"><span class="hn">${esc(k)}</span>
          <span class="ht"><span class="hf" style="width:${v/tmax*100}%;background:var(--info);animation-delay:${i*60}ms"></span></span>
          <span class="hv">${v}</span></div>`).join("")
          :`<p style="color:var(--txt-3);font-size:13px">Nothing sold yet.</p>`}</div>
      <div class="panel"><h3>Shift tasks</h3>
        <div class="ph">Scheduled reminders. Overdue ones turn amber and badge the rail.</div>
        <div class="tasks">${CFG.reminders.map(t=>{
          const due=!t.done&&hhmm(d)>=t.at;
          return`<button class="task ${t.done?"done":""} ${due?"due":""}" onclick="__task('${t.id}')">
            <span class="cb">${t.done?"✓":""}</span><span class="tn">${esc(t.n)}</span>
            <span class="tt">${t.at}</span></button>`}).join("")}</div></div>
    </div>

    <div class="panel"><h3>Cash movements</h3><div class="ph">Everything that touched the drawer outside a sale.</div>
      <div class="frm">
        <button class="mini" onclick="__pin()">Pay in</button>
        <button class="mini" onclick="__pout()">Pay out</button>
        <button class="mini" onclick="__safe()">Safe drop</button>
        <button class="mini" onclick="__train()">${TRAIN?"Leave training mode":"Enter training mode"}</button>
      </div>
      <div class="rpt" style="margin-top:12px">
        <div class="rr"><span>Paid in</span><b>${money(SHIFT.paidIn)}</b></div>
        <div class="rr"><span>Paid out</span><b>−${money(SHIFT.paidOut)}</b></div>
        <div class="rr"><span>Safe drops</span><b>−${money(SHIFT.safeDrops)}</b></div>
      </div></div>

    ${SHIFT.exceptions.length?`<div class="panel"><h3>Exception log</h3>
      <div class="ph">Voids, overrides and drawer opens, with who approved them.</div>
      <div class="rpt">${SHIFT.exceptions.slice().reverse().map(x=>
        `<div class="rr"><span>${esc(x.what)}${x.reason?` · ${esc(x.reason)}`:""}${x.on?` · for ${esc(x.on)}`:""}</span>
        <b style="font-size:12px;color:var(--txt-2)">${esc(x.by)} ${x.at.toLocaleTimeString()}</b></div>`).join("")}</div></div>`:""}
  </div>`;
  window.__pin=payIn;window.__pout=()=>auth("payout","Pay out",payOut);window.__safe=safeDrop;
  window.__train=()=>{TRAIN=!TRAIN;refreshSale();drawOffice();toast(TRAIN?"Training mode on. Sales won't post to the shift.":"Training mode off.")};
}

/* ========================= reports ========================= */
function drawReports(){
  const s=shiftStats();
  window.__x=()=>report(false);window.__z=()=>auth("zreport","Closing the shift",()=>blindCount());
  window.__hist=history_;
  $("vReports").innerHTML=`<div class="pane">
    <h2>Reports</h2>
    <p class="lede">An X read is a look at the open shift and changes nothing. A Z read closes it, and requires
      counting the drawer first without seeing what the system expects.</p>
    <div class="cards">
      <div class="stat"><div class="lbl">Gross sales</div><div class="val num">${money(s.g(x=>x.sub))}</div></div>
      <div class="stat"><div class="lbl">Tax collected</div><div class="val num">${money(s.g(x=>x.taxTotal))}</div></div>
      <div class="stat"><div class="lbl">Discounts given</div><div class="val w num">${money(Math.abs(s.g(x=>x.disc))+Math.abs(s.g(x=>x.promoOff)))}</div></div>
      <div class="stat"><div class="lbl">Net sales</div><div class="val g num">${money(s.net)}</div></div>
    </div>
    <div class="panel"><h3>Reads</h3><div class="ph">Both print the same figures; only Z resets them.</div>
      <div class="frm">
        <button class="mini" onclick="__x()">X read — mid-shift</button>
        <button class="mini" onclick="__z()">Z read — close the shift</button>
        <button class="mini" onclick="__hist()">Transaction journal (${SHIFT.sales.length})</button>
      </div></div>
    <div class="two">
      <div class="panel"><h3>Methods of payment</h3><div class="ph">Split by tender, for reconciling the deposit.</div>
        <div class="rpt">${Object.entries(s.byMop).map(([k,v])=>
          `<div class="rr"><span>${esc(k)}</span><b>${money(v)}</b></div>`).join("")
          ||`<div class="rr"><span>None yet</span><b>0.00</b></div>`}</div></div>
      <div class="panel"><h3>Tax</h3><div class="ph">By rate, as filed.</div>
        <div class="rpt">${CFG.taxRates.filter(r=>r.rate>0).map(r=>
          `<div class="rr"><span>${esc(r.n)} ${r.rate}%</span><b>${money(s.byTax[r.id]||0)}</b></div>`).join("")}</div></div>
    </div></div>`;
}
function history_(){
  const s=SHIFT.sales.slice().reverse();
  const el=veil(`<div class="card tall"><h3>Transaction journal</h3>
    <p>${s.length?"Tap any line to reprint its receipt.":"Nothing recorded yet this shift."}</p>
    <div class="edwrap"><div class="opts" style="flex-direction:column">${s.map(x=>
      `<button data-n="${x.n}" style="width:100%;display:flex;justify-content:space-between">
        <span>#${x.n} ${x.ret?"· Return":""} · ${esc(x.by)}</span>
        <span class="num">${money(Math.abs(x.tot))} · ${x.at.toLocaleTimeString()}</span></button>`).join("")}</div></div>
    <div class="row"><button class="no" id="hn">Close</button></div></div>`);
  el.querySelector("#hn").onclick=()=>el.remove();
  el.querySelectorAll("[data-n]").forEach(b=>b.onclick=()=>{el.remove();
    receipt(SHIFT.sales.find(x=>x.n===+b.dataset.n))});
}
/* Blind balancing: the cashier counts the drawer without being shown the
   expected figure. Only after they commit does the variance appear. */
const DENOMS=[["100",100],["50",50],["20",20],["10",10],["5",5],["1",1],
  ["0.25",.25],["0.10",.10],["0.05",.05],["0.01",.01]];
function blindCount(){
  const el=veil(`<div class="card tall"><h3>Count the drawer</h3>
    <p>Enter the count for each denomination. The expected total stays hidden until you commit,
      so the count can't be worked backwards.</p>
    <div class="edwrap"><div class="denom">${DENOMS.map(([l,v],i)=>
      `<label><span>$${l}</span><input class="num" data-d="${i}" value="0" inputmode="numeric"></label>`).join("")}</div></div>
    <div class="chg"><span>Counted</span><b id="bcTot">0.00</b></div>
    <div class="row"><button class="no" id="bn">Cancel</button><button class="ok" id="by">Commit the count</button></div></div>`);
  const upd=()=>{let t=0;el.querySelectorAll("[data-d]").forEach(i=>t+=(parseInt(i.value)||0)*DENOMS[+i.dataset.d][1]);
    el.querySelector("#bcTot").textContent=money(t);return t};
  el.querySelectorAll("[data-d]").forEach(i=>i.oninput=upd);
  el.querySelector("#bn").onclick=()=>el.remove();
  el.querySelector("#by").onclick=()=>{const t=upd();el.remove();report(true,t)};
}
function report(isZ,counted){
  const s=shiftStats();
  const variance=counted!==undefined?counted-s.drawer:null;
  const el=veil(`<div class="card wide tall"><h3>${isZ?"Z read — shift close":"X read — mid-shift"}</h3>
    <p>Opened ${SHIFT.opened.toLocaleTimeString()} · ${esc(ME.n)} · ${isZ?"closing resets the totals and opens a new shift":"reading only, nothing resets"}</p>
    <div class="edwrap rpt">
      ${counted!==undefined?`<h4>Drawer count</h4>
        <div class="rr"><span>Counted</span><b>${money(counted)}</b></div>
        <div class="rr"><span>Expected</span><b>${money(s.drawer)}</b></div>
        <div class="rr"><span>Variance</span><b style="color:${Math.abs(variance)<0.01?"var(--vfd)":variance<0?"var(--void)":"var(--warn)"}">${variance>0?"+":""}${money(variance)}</b></div>`:""}
      <h4>Transactions</h4>
      <div class="rr"><span>Sales</span><b>${s.cnt}</b></div>
      <div class="rr"><span>Returns</span><b>${s.S.filter(x=>x.ret).length}</b></div>
      <div class="rr"><span>No sales</span><b>${SHIFT.noSales}</b></div>
      <div class="rr"><span>Exceptions logged</span><b>${SHIFT.exceptions.length}</b></div>
      <h4>Department sales</h4>
      ${Object.entries(s.byDept).map(([k,v])=>`<div class="rr"><span>${esc(k)}</span><b>${money(v)}</b></div>`).join("")
        ||`<div class="rr"><span>None</span><b>0.00</b></div>`}
      <h4>Discounts and tax</h4>
      <div class="rr"><span>Automatic promotions</span><b>−${money(Math.abs(s.g(x=>x.promoOff)))}</b></div>
      <div class="rr"><span>Manual discounts</span><b>−${money(Math.abs(s.g(x=>x.disc)))}</b></div>
      ${CFG.taxRates.filter(r=>r.rate>0).map(r=>
        `<div class="rr"><span>${esc(r.n)} ${r.rate}%</span><b>${money(s.byTax[r.id]||0)}</b></div>`).join("")}
      <h4>Methods of payment</h4>
      ${Object.entries(s.byMop).map(([k,v])=>`<div class="rr"><span>${esc(k)}</span><b>${money(v)}</b></div>`).join("")
        ||`<div class="rr"><span>None</span><b>0.00</b></div>`}
      <h4>Drawer</h4>
      <div class="rr"><span>Opening cash</span><b>${money(SHIFT.startCash)}</b></div>
      <div class="rr"><span>Paid in</span><b>${money(SHIFT.paidIn)}</b></div>
      <div class="rr"><span>Paid out</span><b>−${money(SHIFT.paidOut)}</b></div>
      <div class="rr"><span>Safe drops</span><b>−${money(SHIFT.safeDrops)}</b></div>
      <div class="rr"><span>Expected in drawer</span><b>${money(s.drawer)}</b></div>
      <div class="rr tot"><span>Net sales</span><b>${money(s.net)}</b></div>
    </div>
    <div class="row"><button class="no" id="rn">Close</button>${isZ?`<button class="ok" id="rz">Close the shift</button>`:""}</div></div>`);
  el.querySelector("#rn").onclick=()=>el.remove();
  if(isZ)el.querySelector("#rz").onclick=()=>{
    SHIFT={opened:new Date(),sales:[],startCash:counted!==undefined?counted:s.drawer,
      paidIn:0,paidOut:0,safeDrops:0,noSales:0,num:SHIFT.num,exceptions:[]};
    CFG.reminders.forEach(t=>t.done=false);
    el.remove();go("reports");
    toast("Shift closed. A new shift opened with the counted drawer as its opening cash.")};
}
