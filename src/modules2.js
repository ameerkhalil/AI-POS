/* ===========================================================================
   Module library, part two.

   Everything here is built and tested. What varies per store is which ones are
   switched on — a barber never sees gift cards, a butcher never sees table
   numbers. Several of these reach into the sale itself rather than sitting off
   to the side, so they hook the tender and completion paths explicitly.
   =========================================================================== */

Object.assign(MODULES, {
  customers: {
    n: "Customers & loyalty",
    what: "Capture a name and number at the till, keep purchase history, and run points or a punch card.",
    fits: /cloth|boutique|shoe|jewel|salon|barber|nail|spa|caf|coffee|bakery|restaurant|pet|florist|bike|repair/i,
    icon: '<circle cx="12" cy="8" r="3.4"/><path d="M4 21a8 8 0 0 1 16 0"/>'
  },
  tips: {
    n: "Tips",
    what: "A tip prompt on card payments, with the amount split out on the receipt and reported per person.",
    fits: /caf|coffee|restaurant|bar|pub|deli|salon|barber|nail|spa|food truck|pizz|brewery|juice/i,
    icon: '<path d="M12 2v20M17 6.5c0-2-2.2-3.5-5-3.5S7 4.5 7 6.5 9.2 10 12 10s5 1.5 5 3.5-2.2 3.5-5 3.5-5-1.5-5-3.5"/>'
  },
  giftcards: {
    n: "Gift cards",
    what: "Issue a card with a balance, take it as payment, and see what's still outstanding.",
    fits: /cloth|boutique|jewel|salon|barber|spa|restaurant|caf|book|gift|toy|record|sporting|nail/i,
    icon: '<rect x="2" y="6" width="20" height="13" rx="2"/><path d="M2 11h20M12 6v13"/><path d="M12 6c-1.5-3-5-3-5-1s3.5 1 5 1zM12 6c1.5-3 5-3 5-1s-3.5 1-5 1z"/>'
  },
  waste: {
    n: "Waste log",
    what: "Record what got thrown out and why, costed against what you paid for it.",
    fits: /grocer|market|butcher|fish|deli|bakery|caf|coffee|restaurant|produce|florist|cheese|juice|pizz/i,
    icon: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>'
  },
  commission: {
    n: "Commission",
    what: "A percentage per department, worked out per person from the sales they rang.",
    fits: /phone|electronic|cloth|boutique|jewel|furniture|shoe|auto|tire|sporting|watch|camera|bike/i,
    icon: '<path d="M19 5L5 19"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>'
  },
  jobs: {
    n: "Bookings & jobs",
    what: "Appointments or repair tickets, with a status you move along and a customer attached.",
    fits: /salon|barber|nail|spa|repair|phone|computer|auto|tire|bike|watch|tailor|flooring|camera/i,
    icon: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 11h18"/><path d="M9 15l2 2 4-4"/>'
  },
  service: {
    n: "Tabs & tables",
    what: "Open a tab against a table or a name, add to it through the night, settle it at the end.",
    fits: /bar|pub|restaurant|brewery|taproom|pizz|caf|food truck|deli/i,
    icon: '<path d="M4 4h16v6a8 8 0 0 1-16 0z"/><path d="M12 18v3M8 21h8"/>'
  }
});

/* ============================== customers ============================== */
function custCfg(){
  const c=modCfg("customers");
  if(!c.people)c.people=[];
  if(!c.loyalty)c.loyalty={on:false,kind:"points",per:1,reward:100,rewardValue:5};
  if(!c.ask)c.ask="ask";
  return c;
}
function findCustomer(q){
  const c=custCfg(),k=String(q||"").toLowerCase().replace(/[^a-z0-9]/g,"");
  if(!k)return null;
  return c.people.find(p=>String(p.phone||"").replace(/\D/g,"").includes(k)
    ||String(p.n||"").toLowerCase().includes(String(q).toLowerCase()));
}
/* Runs at tender. Skipped entirely when the module is off, so a shop that
   doesn't want to ask never sees a prompt. */
function askCustomer(){
  const c=custCfg();
  if(!modOn("customers")||c.ask==="never")return Promise.resolve(null);
  return new Promise(res=>{
    const el=veil(`<div class="card"><h3>Customer</h3>
      <p>Phone number or name. Leave it blank to carry on without one.</p>
      <input id="cuq" class="big" style="text-align:left;font-size:18px" placeholder="555 0100">
      <div id="cures" style="margin-top:12px"></div>
      <div class="row"><button class="no" id="cusk">Skip</button>
        <button class="ok" id="cuok">Use this</button></div></div>`);
    const inp=el.querySelector("#cuq"),out=el.querySelector("#cures");
    let hit=null;
    inp.oninput=()=>{
      hit=findCustomer(inp.value);
      out.innerHTML=hit?`<div class="chg"><span>${esc(hit.n||"—")}<br>
        <span style="font-size:11.5px;color:var(--txt-3)">${esc(hit.phone||"")} ·
        ${hit.visits||0} visit${hit.visits===1?"":"s"}</span></span>
        ${c.loyalty.on?`<b>${hit.points||0} pts</b>`:""}</div>`
        :inp.value.trim()?`<p style="color:var(--txt-3);font-size:12.5px">New customer — they'll be
          added when the sale completes.</p>`:"";
    };
    inp.focus();
    el.querySelector("#cusk").onclick=()=>{el.remove();res(null)};
    el.querySelector("#cuok").onclick=()=>{
      const v=inp.value.trim();el.remove();
      if(!v)return res(null);
      res(hit||{id:"C"+uid(),n:/\d/.test(v)?"":v,phone:/\d/.test(v)?v:"",visits:0,points:0,spent:0});
    };
    inp.onkeydown=e=>{if(e.key==="Enter")el.querySelector("#cuok").click()};
  });
}
function recordCustomer(sale){
  if(!modOn("customers")||!sale.customer)return;
  const c=custCfg();
  let p=c.people.find(x=>x.id===sale.customer.id);
  if(!p){p={...sale.customer,first:new Date().toISOString().slice(0,10)};c.people.push(p)}
  p.visits=(p.visits||0)+1;
  p.spent=(p.spent||0)+Math.abs(sale.tot);
  p.last=new Date().toISOString().slice(0,10);
  if(c.loyalty.on){
    const earned=c.loyalty.kind==="punch"?1:Math.floor(Math.abs(sale.tot)*c.loyalty.per);
    p.points=(p.points||0)+earned;
    sale.pointsEarned=earned;
  }
  setModule("customers",true,c);
}
function tCustomers(){
  const c=custCfg();
  W.setCu=(id,f,v)=>{const p=c.people.find(x=>x.id===id);p[f]=f==="points"?(parseInt(v)||0):v;queueSave()};
  W.delCu=id=>{c.people=c.people.filter(p=>p.id!==id);setModule("customers",true,c);refresh();queueSave()};
  W.setLoy=(f,v)=>{c.loyalty[f]=(f==="on")?v:(f==="kind"?v:(parseFloat(v)||0));
    setModule("customers",true,c);refresh();queueSave()};
  W.setAsk=v=>{c.ask=v;setModule("customers",true,c);queueSave()};
  const top=c.people.slice().sort((a,b)=>(b.spent||0)-(a.spent||0));
  $("cfgBody").innerHTML=`
    <div class="cards" style="margin-top:2px">
      <div class="stat"><div class="lbl">Customers</div><div class="val">${c.people.length}</div></div>
      <div class="stat"><div class="lbl">Repeat</div>
        <div class="val g">${c.people.filter(p=>(p.visits||0)>1).length}</div>
        <div class="sub2">more than one visit</div></div>
      <div class="stat"><div class="lbl">Average spend</div>
        <div class="val num">${money(c.people.length?c.people.reduce((a,p)=>a+(p.spent||0),0)/c.people.length:0)}</div></div>
    </div>
    <div class="sect">At the till</div>
    <div class="frm">
      <label>Ask for a customer<select onchange="__w.setAsk(this.value)">
        <option value="ask" ${c.ask==="ask"?"selected":""}>On every sale</option>
        <option value="card" ${c.ask==="card"?"selected":""}>Only on card payments</option>
        <option value="never" ${c.ask==="never"?"selected":""}>Never — I'll add them here</option>
      </select></label>
    </div>
    <div class="sect">Loyalty</div>
    <div class="frm">
      <label>Scheme<select onchange="__w.setLoy('kind',this.value)">
        <option value="points" ${c.loyalty.kind==="points"?"selected":""}>Points per dollar</option>
        <option value="punch" ${c.loyalty.kind==="punch"?"selected":""}>Punch card — one per visit</option>
      </select></label>
      ${c.loyalty.kind==="points"
        ?`<label>Points per dollar<input class="n" value="${c.loyalty.per}" oninput="__w.setLoy('per',this.value)"></label>`
        :``}
      <label>Reward at<input class="n" value="${c.loyalty.reward}" oninput="__w.setLoy('reward',this.value)"></label>
      <label>Reward worth<input class="n" value="${money(c.loyalty.rewardValue)}" oninput="__w.setLoy('rewardValue',this.value)"></label>
      <label>Running<br><input type="checkbox" ${c.loyalty.on?"checked":""}
        onchange="__w.setLoy('on',this.checked)" style="width:auto;margin-top:10px"></label>
    </div>
    <div class="sect">People — ${c.people.length}</div>
    ${c.people.length?`<table class="tbl"><thead><tr><th style="width:24%">Name</th>
      <th style="width:18%">Phone</th><th style="width:22%">Email</th><th>Visits</th>
      <th>Spent</th>${c.loyalty.on?`<th>Points</th>`:""}<th>Last in</th><th></th></tr></thead><tbody>
      ${top.map(p=>`<tr>
        <td><input value="${esc(p.n||"")}" oninput="__w.setCu('${p.id}','n',this.value)"></td>
        <td><input class="n" value="${esc(p.phone||"")}" oninput="__w.setCu('${p.id}','phone',this.value)"></td>
        <td><input value="${esc(p.email||"")}" placeholder="for deals" oninput="__w.setCu('${p.id}','email',this.value)"></td>
        <td style="padding-left:9px" class="num">${p.visits||0}</td>
        <td style="padding-left:9px" class="num">${money(p.spent||0)}</td>
        ${c.loyalty.on?`<td><input class="n" value="${p.points||0}" oninput="__w.setCu('${p.id}','points',this.value)"></td>`:""}
        <td style="padding-left:9px;color:var(--txt-2);font-size:12.5px">${esc(p.last||"—")}</td>
        <td><button class="del" onclick="__w.delCu('${p.id}')">×</button></td></tr>`).join("")}
      </tbody></table>`
    :`<p style="color:var(--txt-3);font-size:13px;padding:14px 2px">Nobody yet. They're added from the
      till when a cashier takes a number.</p>`}
    <div class="note">Email addresses are collected so you can send offers. That's a marketing list —
      only send to people who agreed to it, and give them a way out.</div>`;
}

/* ================================= tips ================================ */
function tipCfg(){const c=modCfg("tips");if(!c.presets)c.presets=[15,18,20];return c}
function askTip(due){
  if(!modOn("tips"))return Promise.resolve(0);
  const c=tipCfg();
  return new Promise(res=>{
    const el=veil(`<div class="card"><h3>Add a tip?</h3>
      <p>On ${money(due)}. Turn the screen to the customer.</p>
      <div class="opts">${c.presets.map(p=>
        `<button data-t="${p}">${p}%<em style="display:block;font-style:normal;font-size:11.5px;
          color:var(--txt-3);margin-top:3px">${money(due*p/100)}</em></button>`).join("")}
        <button data-t="0">No tip</button></div>
      <input id="tipv" class="big num" value="0.00" inputmode="decimal">
      <div class="row"><button class="no" id="tipn">Skip</button>
        <button class="ok" id="tipy">Add this amount</button></div></div>`);
    el.querySelectorAll("[data-t]").forEach(b=>b.onclick=()=>{el.remove();res(due*(+b.dataset.t)/100)});
    el.querySelector("#tipn").onclick=()=>{el.remove();res(0)};
    el.querySelector("#tipy").onclick=()=>{el.remove();res(parseFloat(el.querySelector("#tipv").value)||0)};
  });
}
function tTips(){
  const c=tipCfg();
  W.setTip=(i,v)=>{c.presets[i]=parseFloat(v)||0;setModule("tips",true,c);queueSave()};
  const byStaff={};
  SHIFT.sales.forEach(s=>{if(s.tip>0){const k=s.by||"—";byStaff[k]=(byStaff[k]||0)+s.tip}});
  const total=Object.values(byStaff).reduce((a,v)=>a+v,0);
  $("cfgBody").innerHTML=`
    <div class="cards" style="margin-top:2px">
      <div class="stat"><div class="lbl">Tips this shift</div><div class="val g num">${money(total)}</div></div>
      <div class="stat"><div class="lbl">Sales tipped</div>
        <div class="val">${SHIFT.sales.filter(s=>s.tip>0).length} of ${SHIFT.sales.length}</div></div>
    </div>
    <div class="sect">Suggested percentages</div>
    <div class="frm">${c.presets.map((p,i)=>
      `<label>Option ${i+1}<input class="n" value="${p}" oninput="__w.setTip(${i},this.value)"></label>`).join("")}</div>
    <div class="sect">By person</div>
    ${Object.keys(byStaff).length?`<div class="rpt">${Object.entries(byStaff)
      .sort((a,b)=>b[1]-a[1]).map(([n,v])=>
      `<div class="rr"><span>${esc(n)}</span><b>${money(v)}</b></div>`).join("")}</div>`
    :`<p style="color:var(--txt-3);font-size:13px;padding:12px 2px">No tips yet this shift.</p>`}
    <div class="note">The prompt appears on card payments only, and the tip prints as its own line so
      the sale total and the tip never get confused on a report.</div>`;
}

/* ============================== gift cards ============================= */
function gcCfg(){const c=modCfg("giftcards");if(!c.cards)c.cards=[];return c}
function tGiftcards(){
  const c=gcCfg();
  W.issueGC=()=>ask({t:"Issue a gift card",p:"How much is on it?",num:"25.00",yes:"Issue it",
    done:v=>{
      const code=String(Math.floor(1e11+Math.random()*9e11));
      c.cards.unshift({code,start:+v,bal:+v,at:new Date().toISOString().slice(0,10),by:ME?.n||""});
      setModule("giftcards",true,c);refresh();queueSave();
      alertCard("Card issued",`Code ${code} — ${money(+v)}. Write it on the card or print the receipt.`);
    }});
  W.voidGC=code=>{c.cards=c.cards.filter(x=>x.code!==code);setModule("giftcards",true,c);refresh();queueSave()};
  const live=c.cards.filter(x=>x.bal>0.005);
  $("cfgBody").innerHTML=`
    <div class="cards" style="margin-top:2px">
      <div class="stat"><div class="lbl">Cards live</div><div class="val">${live.length}</div></div>
      <div class="stat"><div class="lbl">Outstanding</div>
        <div class="val w num">${money(live.reduce((a,x)=>a+x.bal,0))}</div>
        <div class="sub2">money you already took</div></div>
      <div class="stat"><div class="lbl">Issued all time</div>
        <div class="val num">${money(c.cards.reduce((a,x)=>a+x.start,0))}</div></div>
    </div>
    <button class="mini" onclick="__w.issueGC()">Issue a card</button>
    <div class="sect">Cards</div>
    ${c.cards.length?`<table class="tbl"><thead><tr><th style="width:26%">Code</th>
      <th>Issued for</th><th>Balance</th><th>Issued</th><th>By</th><th></th></tr></thead><tbody>
      ${c.cards.map(x=>`<tr>
        <td style="padding-left:9px" class="num">${esc(x.code)}</td>
        <td style="padding-left:9px" class="num">${money(x.start)}</td>
        <td style="padding-left:9px" class="num" style="color:${x.bal>0.005?"var(--vfd)":"var(--txt-3)"}">${money(x.bal)}</td>
        <td style="padding-left:9px;color:var(--txt-2);font-size:12.5px">${esc(x.at)}</td>
        <td style="padding-left:9px;color:var(--txt-2);font-size:12.5px">${esc(x.by||"—")}</td>
        <td><button class="del" onclick="__w.voidGC('${x.code}')">×</button></td></tr>`).join("")}
      </tbody></table>`
    :`<p style="color:var(--txt-3);font-size:13px;padding:14px 2px">None issued yet.</p>`}
    <div class="note">An outstanding balance is money you've been paid for goods you haven't handed over.
      Worth remembering it's a liability, not takings.</div>`;
}

/* ================================ waste ================================ */
function wasteCfg(){const c=modCfg("waste");if(!c.log)c.log=[];return c}
function tWaste(){
  const c=wasteCfg();
  const REASONS=["Expired","Damaged","Spoiled","Dropped","Customer return","Staff error","Theft","Other"];
  W.addWaste=()=>{
    c.log.unshift({id:"W"+uid(),pluId:CFG.plus[0]?.id||null,qty:1,reason:"Expired",
      at:new Date().toISOString().slice(0,10),by:ME?.n||"",note:""});
    setModule("waste",true,c);refresh();queueSave();
  };
  W.setWaste=(id,f,v)=>{const w=c.log.find(x=>x.id===id);
    w[f]=f==="qty"?(parseFloat(v)||0):v;queueSave();if(f!=="note")refresh()};
  W.delWaste=id=>{c.log=c.log.filter(x=>x.id!==id);setModule("waste",true,c);refresh();queueSave()};
  const costOf=w=>{const p=byId(CFG.plus,w.pluId);return (p?.cost||0)*w.qty};
  const total=c.log.reduce((a,w)=>a+costOf(w),0);
  const byReason={};c.log.forEach(w=>byReason[w.reason]=(byReason[w.reason]||0)+costOf(w));
  const worst=Object.entries(byReason).sort((a,b)=>b[1]-a[1]);
  $("cfgBody").innerHTML=`
    <div class="cards" style="margin-top:2px">
      <div class="stat"><div class="lbl">Written off</div>
        <div class="val ${total?"":"g"}" style="${total?"color:var(--void)":""}">${money(total)}</div>
        <div class="sub2">at what you paid</div></div>
      <div class="stat"><div class="lbl">Entries</div><div class="val">${c.log.length}</div></div>
      <div class="stat"><div class="lbl">Biggest cause</div>
        <div class="val" style="font-size:19px">${worst[0]?esc(worst[0][0]):"—"}</div>
        <div class="sub2">${worst[0]?money(worst[0][1]):""}</div></div>
    </div>
    <button class="mini" onclick="__w.addWaste()">Log something</button>
    <div class="sect">Log</div>
    <table class="tbl"><thead><tr><th style="width:26%">Product</th><th style="width:8%">Qty</th>
      <th style="width:16%">Reason</th><th style="width:12%">Cost</th><th style="width:13%">Date</th>
      <th style="width:13%">By</th><th>Note</th><th></th></tr></thead><tbody>
    ${c.log.map(w=>`<tr>
      <td><select onchange="__w.setWaste('${w.id}','pluId',this.value)">${CFG.plus.map(p=>
        `<option value="${p.id}" ${w.pluId===p.id?"selected":""}>${esc(p.n)}</option>`).join("")}</select></td>
      <td><input class="n" value="${w.qty}" oninput="__w.setWaste('${w.id}','qty',this.value)"></td>
      <td><select onchange="__w.setWaste('${w.id}','reason',this.value)">${REASONS.map(r=>
        `<option ${w.reason===r?"selected":""}>${r}</option>`).join("")}</select></td>
      <td style="padding-left:9px" class="num">${money(costOf(w))}</td>
      <td><input type="date" value="${esc(w.at)}" oninput="__w.setWaste('${w.id}','at',this.value)"></td>
      <td><select onchange="__w.setWaste('${w.id}','by',this.value)"><option value=""></option>${
        CFG.employees.map(e=>`<option ${w.by===e.n?"selected":""}>${esc(e.n)}</option>`).join("")}</select></td>
      <td><input value="${esc(w.note||"")}" oninput="__w.setWaste('${w.id}','note',this.value)"></td>
      <td><button class="del" onclick="__w.delWaste('${w.id}')">×</button></td></tr>`).join("")
      ||`<tr><td colspan="8" style="padding:14px;color:var(--txt-3)">Nothing logged.</td></tr>`}
    </tbody></table>
    <div class="note">Costed from what you paid, not what you'd have sold it for — the loss is the cost,
      the rest is margin you never had.</div>`;
}

/* ============================= commission ============================== */
function commCfg(){const c=modCfg("commission");if(!c.rates)c.rates={};if(!c.base)c.base=0;return c}
function tCommission(){
  const c=commCfg();
  W.setRate=(d,v)=>{c.rates[d]=parseFloat(v)||0;setModule("commission",true,c);refresh();queueSave()};
  W.setBase=v=>{c.base=parseFloat(v)||0;setModule("commission",true,c);refresh();queueSave()};
  const earned={};
  SHIFT.sales.filter(s=>!s.ret).forEach(s=>{
    const k=s.by||"—";earned[k]=earned[k]||{sales:0,comm:0};
    earned[k].sales+=s.tot;
    s.lines.forEach(l=>{
      const d=byId(CFG.depts,l.deptId);
      const rate=(d&&c.rates[d.id]!=null)?c.rates[d.id]:c.base;
      earned[k].comm+=l.price*l.q*(1-(l.disc||0)/100)*rate/100;
    });
  });
  $("cfgBody").innerHTML=`
    <div class="sect">Rates</div>
    <div class="frm"><label>Default rate on everything
      <input class="n" value="${c.base}" oninput="__w.setBase(this.value)"></label></div>
    <table class="tbl" style="margin-top:12px"><thead><tr><th style="width:50%">Department</th>
      <th style="width:20%">Rate %</th><th>Uses default</th></tr></thead><tbody>
    ${CFG.depts.filter(d=>!d.fuel).map(d=>`<tr>
      <td style="padding-left:9px">${esc(d.n)}</td>
      <td><input class="n" value="${c.rates[d.id]!=null?c.rates[d.id]:""}" placeholder="${c.base}"
        oninput="__w.setRate('${d.id}',this.value)"></td>
      <td style="padding-left:9px;color:var(--txt-3);font-size:12.5px">${
        c.rates[d.id]!=null?"no":"yes"}</td></tr>`).join("")}
    </tbody></table>
    <div class="sect">Earned this shift</div>
    ${Object.keys(earned).length?`<table class="tbl"><thead><tr><th style="width:34%">Person</th>
      <th>Sales</th><th>Commission</th><th>Effective rate</th></tr></thead><tbody>
      ${Object.entries(earned).sort((a,b)=>b[1].comm-a[1].comm).map(([n,v])=>`<tr>
        <td style="padding-left:9px">${esc(n)}</td>
        <td style="padding-left:9px" class="num">${money(v.sales)}</td>
        <td style="padding-left:9px" class="num" style="color:var(--vfd)">${money(v.comm)}</td>
        <td style="padding-left:9px" class="num">${v.sales?((v.comm/v.sales)*100).toFixed(1):"0.0"}%</td>
      </tr>`).join("")}</tbody></table>`
    :`<p style="color:var(--txt-3);font-size:13px;padding:14px 2px">No sales this shift yet.</p>`}
    <div class="note">Worked out from the lines actually rung, so a department rate change applies from
      that moment on rather than retroactively.</div>`;
}

/* ============================ bookings & jobs ========================== */
function jobCfg(){
  const c=modCfg("jobs");
  if(!c.jobs)c.jobs=[];
  if(!c.stages)c.stages=["Booked","In progress","Ready","Collected"];
  if(!c.kind)c.kind="appointment";
  return c;
}
function tJobs(){
  const c=jobCfg();
  W.addJob=()=>{
    c.jobs.unshift({id:"J"+uid(),who:"",phone:"",what:"",stage:c.stages[0],
      when:new Date().toISOString().slice(0,16),by:ME?.n||"",price:0,note:""});
    setModule("jobs",true,c);refresh();queueSave();
  };
  W.setJob=(id,f,v)=>{const j=c.jobs.find(x=>x.id===id);
    j[f]=f==="price"?(parseFloat(v)||0):v;queueSave();if(f==="stage")refresh()};
  W.delJob=id=>{c.jobs=c.jobs.filter(x=>x.id!==id);setModule("jobs",true,c);refresh();queueSave()};
  W.setKind=v=>{c.kind=v;
    c.stages=v==="repair"?["Taken in","Diagnosed","In progress","Ready","Collected"]
      :["Booked","Arrived","In progress","Done"];
    setModule("jobs",true,c);refresh();queueSave()};
  const byStage={};c.stages.forEach(s=>byStage[s]=c.jobs.filter(j=>j.stage===s));
  $("cfgBody").innerHTML=`
    <div class="frm">
      <label>What are you tracking<select onchange="__w.setKind(this.value)">
        <option value="appointment" ${c.kind==="appointment"?"selected":""}>Appointments</option>
        <option value="repair" ${c.kind==="repair"?"selected":""}>Repairs and jobs</option>
      </select></label>
    </div>
    <div class="stages">${c.stages.map(s=>`<div class="stagecol">
      <div class="stagehd">${esc(s)}<em>${byStage[s].length}</em></div>
      ${byStage[s].map(j=>`<div class="jobcard">
        <b>${esc(j.who||"No name")}</b>
        <span>${esc(j.what||"—")}</span>
        <em>${esc((j.when||"").replace("T"," "))}${j.price?` · ${money(j.price)}`:""}</em>
      </div>`).join("")||`<div class="stageempty">—</div>`}
    </div>`).join("")}</div>
    <button class="mini" onclick="__w.addJob()">Add ${c.kind==="repair"?"a job":"a booking"}</button>
    <div class="sect">All ${c.kind==="repair"?"jobs":"bookings"}</div>
    <table class="tbl"><thead><tr><th style="width:16%">Customer</th><th style="width:13%">Phone</th>
      <th style="width:22%">${c.kind==="repair"?"Work":"For"}</th><th style="width:15%">When</th>
      <th style="width:14%">Stage</th><th style="width:10%">Price</th><th></th></tr></thead><tbody>
    ${c.jobs.map(j=>`<tr>
      <td><input value="${esc(j.who)}" oninput="__w.setJob('${j.id}','who',this.value)"></td>
      <td><input class="n" value="${esc(j.phone)}" oninput="__w.setJob('${j.id}','phone',this.value)"></td>
      <td><input value="${esc(j.what)}" oninput="__w.setJob('${j.id}','what',this.value)"></td>
      <td><input type="datetime-local" value="${esc(j.when)}" oninput="__w.setJob('${j.id}','when',this.value)"></td>
      <td><select onchange="__w.setJob('${j.id}','stage',this.value)">${c.stages.map(s=>
        `<option ${j.stage===s?"selected":""}>${esc(s)}</option>`).join("")}</select></td>
      <td><input class="n" value="${money(j.price)}" oninput="__w.setJob('${j.id}','price',this.value)"></td>
      <td><button class="del" onclick="__w.delJob('${j.id}')">×</button></td></tr>`).join("")
      ||`<tr><td colspan="7" style="padding:14px;color:var(--txt-3)">Nothing booked.</td></tr>`}
    </tbody></table>`;
}

/* ============================= tabs & tables =========================== */
function svcCfg(){const c=modCfg("service");if(!c.open)c.open=[];if(!c.tables)c.tables=12;return c}
function tService(){
  const c=svcCfg();
  W.setTables=v=>{c.tables=parseInt(v)||0;setModule("service",true,c);refresh();queueSave()};
  W.closeTab=id=>{c.open=c.open.filter(t=>t.id!==id);setModule("service",true,c);refresh();queueSave()};
  $("cfgBody").innerHTML=`
    <p class="lede" style="margin:0 0 6px">Open tabs are held sales with a name or a table on them.
      Start one from the register with <b>Hold</b>, bring it back with <b>Recall</b>.</p>
    <div class="frm"><label>How many tables
      <input class="n" value="${c.tables}" oninput="__w.setTables(this.value)"></label></div>
    <div class="sect">Open now — ${HELD.length}</div>
    ${HELD.length?`<table class="tbl"><thead><tr><th style="width:22%">Tab</th><th>Items</th>
      <th>Running total</th><th>Opened</th><th>By</th></tr></thead><tbody>
      ${HELD.map(h=>{
        const n=h.lines.reduce((a,l)=>a+l.q,0),v=h.lines.reduce((a,l)=>a+l.price*l.q,0);
        return `<tr><td style="padding-left:9px">${esc(h.label||("#"+h.n))}</td>
        <td style="padding-left:9px" class="num">${n}</td>
        <td style="padding-left:9px" class="num">${money(v)}</td>
        <td style="padding-left:9px;color:var(--txt-2);font-size:12.5px">${h.at.toLocaleTimeString()}</td>
        <td style="padding-left:9px;color:var(--txt-2);font-size:12.5px">${esc(h.by||"—")}</td></tr>`}).join("")}
      </tbody></table>`
    :`<p style="color:var(--txt-3);font-size:13px;padding:14px 2px">No tabs open.</p>`}
    <div class="note">A tab lives on this terminal until it's settled. On a second register it won't
      appear — one till per section is the usual arrangement until multi-terminal lands.</div>`;
}
