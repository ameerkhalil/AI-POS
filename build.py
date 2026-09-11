"""Assemble public/app.html from the POS sources, patched for the server."""
import re, os, time, hashlib
SRC="src"
css=open(f"{SRC}/style.css").read()
app=open(f"{SRC}/app.js").read()
pri=open(f"{SRC}/pricing.js").read()
thm=open(f"{SRC}/theme.js").read()
imp=open(f"{SRC}/importer.js").read()
hw=open(f"{SRC}/hardware.js").read()
mod=open(f"{SRC}/modules.js").read()
mod2=open(f"{SRC}/modules2.js").read()
stu=open(f"{SRC}/studio.js").read()
cls=open(f"{SRC}/classic.js").read()
shl=open(f"{SRC}/shells.js").read()
msh=open(f"{SRC}/menu-shell.js").read()
sh2=open(f"{SRC}/shells2.js").read()
sh3=open(f"{SRC}/shells3.js").read()
lic=open(f"{SRC}/licence.js").read()
stk=open(f"{SRC}/stock-ui.js").read()
rpt=open(f"{SRC}/reports-ui.js").read()
pur=open(f"{SRC}/purchasing-ui.js").read()
loy=open(f"{SRC}/loyalty-ui.js").read()
tob=open(f"{SRC}/tobacco-ui.js").read()
cen=open(f"{SRC}/central-ui.js").read()
dsp=open(f"{SRC}/display.js").read()
err=open(f"{SRC}/errors-ui.js").read()
svc=open(f"{SRC}/services-ui.js").read()
cfg=open(f"{SRC}/config.js").read()
per=open("lib/persist.js").read()
off=open("lib/offline.js").read()

# ---- 1. the direct Anthropic call is replaced by the one in persist.js ------
app=re.sub(r'async function callAI\(prompt,opts=\{\}\)\{.*?\n\}\n', '', app, flags=re.S)
assert "async function callAI" not in app, "old callAI still present"

# ---- 2. the wizard no longer starts itself; initApp decides ----------------
# Only the top-level call, never one nested in a handler. Anchored to the line
# that follows it so an indentation slip can't take the wizard's own call with it.
app=app.replace("\n\ndraw();\n\n/* ========================= AI generation",
                "\n\n/* start is owned by initApp() in persist.js */\n\n/* ========================= AI generation")
assert "\n\ndraw();\n\n" not in app, "a stray top-level draw() survived"

# ---- 3. config edits mark the store dirty ----------------------------------
cfg=cfg.replace("const reload=()=>{", "const reload=()=>{queueSave();")

# ---- 4. sales post to the journal; shifts open and close server-side -------
app=app.replace("  if(!TRAIN)SHIFT.sales.push(sale);",
                "  if(!TRAIN){SHIFT.sales.push(sale);postSale(sale)}")
app=app.replace("""    SHIFT={opened:new Date(),sales:[],startCash:counted!==undefined?counted:s.drawer,
      paidIn:0,paidOut:0,safeDrops:0,noSales:0,num:SHIFT.num,exceptions:[]};""",
"""    closeShift(counted,{net:s.net,drawer:s.drawer,byMop:s.byMop,byDept:s.byDept});
    SHIFT={opened:new Date(),sales:[],startCash:counted!==undefined?counted:s.drawer,
      paidIn:0,paidOut:0,safeDrops:0,noSales:0,num:SHIFT.num,exceptions:[]};
    openShift(SHIFT.startCash);""")
app=app.replace("  wireSale();go(\"sale\");",
                "  wireSale();go(\"sale\");\n  if(!SHIFT_ID)openShift(SHIFT.startCash);\n  setSaveState(\"saved\");")

# ---- 5. finishing the wizard writes the first config ----------------------
app=app.replace("  paint();CFG=compile(gen);setTimeout(boot,340);",
                "  paint();CFG=compile(gen);saveNow();setTimeout(boot,340);")
app=app.replace("$(\"fb\").onclick=()=>{CFG=compile(FALLBACK());boot()};",
                "$(\"fb\").onclick=()=>{CFG=compile(FALLBACK());saveNow();boot()};")
app=app.replace("if(!gen.depts.length){CFG=compile(FALLBACK());boot();return}",
                "if(!gen.depts.length){CFG=compile(FALLBACK());saveNow();boot();return}")

# ---- 6. header gains a save indicator and an account button ---------------
head_old='''    <div class="tchip"><span class="sig"></span>Online</div>'''
head_new='''    <div class="tchip save saved" id="saveChip">Saved</div>
    <div class="tchip hw off" id="hwChip">Checking hardware</div>
    <div class="tchip net on" id="netChip"><span class="sig"></span>Online</div>'''
lock_old='''    <button class="tbtn2" id="btnLock">Lock</button>'''
lock_new='''    <button class="tbtn2" id="btnAcct">Account</button>
    <button class="tbtn2" id="btnLock">Lock</button>'''
app=app.replace('  $("btnLock").onclick=()=>{ME=null;signIn()};',
                '  $("btnLock").onclick=()=>{ME=null;signIn()};\n  $("btnAcct").onclick=accountMenu;')

css+='''
.tchip.save{transition:color .2s,border-color .2s}
.tchip.save.pending{color:var(--warn);border-color:rgba(224,178,85,.4)}
.tchip.save.saving{color:var(--txt-2)}
.tchip.save.saved{color:var(--txt-3)}
.tchip.save.error{color:var(--void);border-color:rgba(210,102,76,.5)}
'''

shell=open("shell.html").read()
html=(shell.replace("__CSS__",css).replace("__APP__",app).replace("__PRI__",pri)
      .replace("__THM__",thm).replace("__IMP__",imp).replace("__HW__",hw).replace("__MOD__",mod).replace("__MOD2__",mod2).replace("__STUDIO__",stu).replace("__CLASSIC__",cls).replace("__SHELLS__",shl).replace("__MENUSHELL__",msh).replace("__SHELLS2__",sh2).replace("__SHELLS3__",sh3).replace("__LICENCE__",lic).replace("__STOCKUI__",stk).replace("__REPORTSUI__",rpt).replace("__PURUI__",pur).replace("__LOYUI__",loy).replace("__TOBUI__",tob).replace("__CENUI__",cen).replace("__DISPLAY__",dsp).replace("__ERRORSUI__",err).replace("__SVCUI__",svc).replace("__CFG__",cfg).replace("__OFFLINE__",off).replace("__PERSIST__",per)
      .replace(head_old,head_new).replace(lock_old,lock_new))
os.makedirs("public",exist_ok=True)
open("public/app.html","w").write(html)

# The service worker cache name is derived from the built output, so a rebuild
# that changes nothing keeps the same cache and one that changes anything
# invalidates it. No more clearing DevTools to see an update.
stamp = hashlib.sha1(html.encode()).hexdigest()[:10]
html = html.replace("__BUILD__", stamp)
open("public/app.html","w").write(html)
sw = open("public/sw.js").read()
sw = re.sub(r'const CACHE = "[^"]+";', f'const CACHE = "aipos-{stamp}";', sw)
open("public/sw.js","w").write(sw)
print("  sw cache:", stamp)

# ---- SELF CHECK -----------------------------------------------------------
# Every one of these has been broken at least once by a string replacement that
# silently didn't match. Cheaper to assert than to find it on a register.
checks = [
    ("no placeholders left",      lambda h: not re.search(r"__[A-Z]+__", h)),
    ("per-item approval",         lambda h: "__w.togItem" in h),
    ("previews carry item ids",   lambda h: "id:p.id,name:p.n" in h),
    ("margin fraction guard",     lambda h: "function marginValue" in h),
    ("offline queue",             lambda h: "queueSale" in h and "/api/sync" in h),
    ("card capture guard",        lambda h: "capturePayment" in h),
    ("linked returns",            lambda h: "findOriginal" in h),
    ("undo stack",                lambda h: "function snapshot" in h),
    ("build stamped",             lambda h: 'const BUILD="' in h),
    ("module registry",           lambda h: "const MODULES = {" in h),
    ("design studio",             lambda h: "function openStudio" in h and "launchPOS" in h),
    ("forecourt services",        lambda h: "function tServices2" in h and "function svcRec" in h),
    ("error reporting",           lambda h: "function reportError" in h and "unhandledrejection" in h),
    ("customer display",          lambda h: "function displayView" in h and "function displayDone" in h),
    ("central pricebook",         lambda h: "function tCentral" in h and "function renderPlan" in h),
    ("tobacco scan data",         lambda h: "function tTobacco" in h and "function tobBuydowns" in h),
    ("loyalty",                   lambda h: "function tLoyalty" in h and "function loyOffers" in h),
    ("purchasing",                lambda h: "function tPurchasing" in h and "function purOrder" in h),
    ("reports",                   lambda h: "function tReports2" in h and "function rptBusy" in h),
    ("inventory",                 lambda h: "function tStock" in h and "function stkCount" in h),
    ("licence scanning",          lambda h: "function parseLicence" in h),
    ("classic register",          lambda h: "function drawClassic" in h),
    ("menu experience",           lambda h: "function mnReviewScreen" in h and "function mnDoneScreen" in h),
    ("five shells",               lambda h: all(f"function draw{n}Shell" in h for n in ["Menu","Commerce","Board","Kiosk"])),
]
# Every register must have a preview of its own. Falling back to another
# register's mock is what made five different shells look identical.
shells = re.findall(r'shell:"(\w+)"', html)
shots = re.search(r'const shots = \{([\s\S]*?)\n  \};', html)
missing_shots = [s for s in set(shells) if shots and f"\n    {s}:" not in shots.group(1)]
if missing_shots:
    raise SystemExit("BUILD FAILED — no chooser preview for: " + ", ".join(missing_shots))
print("  every register has a preview")

bad = [n for n, f in checks if not f(html)]
if bad:
    raise SystemExit("BUILD FAILED — missing: " + ", ".join(bad))
print("  self check: all", len(checks), "passed")
print("public/app.html:",round(len(html)/1024,1),"kb")
