/* ---------------------------------------------------------------------------
   Pricebook import.

   This is the feature that decides whether a store can switch. Every POS
   migration dies at "now type in your four thousand items", so the job here is
   to accept whatever file the merchant can actually get out of their old system
   or their distributor — a NAXML export, a vendor CSV, a spreadsheet somebody
   maintained by hand — and turn it into a pricebook without anyone typing a
   price.

   The model is used for one narrow thing: working out which column is which.
   That is a judgement call on ten sample rows. Parsing the other four thousand
   is arithmetic, and arithmetic belongs in code where it can be checked.
   --------------------------------------------------------------------------- */

/* A CSV parser that survives quoted commas, escaped quotes and CRLF, because
   real distributor exports contain all three. */
function parseCSV(text, delim) {
  const d = delim || sniffDelim(text);
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === d) { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ""));
}
function sniffDelim(text) {
  const line = text.split("\n").find(l => l.trim()) || "";
  const counts = [[",", 0], [";", 0], ["\t", 0], ["|", 0]]
    .map(([d]) => [d, (line.match(new RegExp("\\" + d, "g")) || []).length]);
  return counts.sort((a, b) => b[1] - a[1])[0][1] ? counts[0][0] : ",";
}
const numOf = v => {
  const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : null;
};

/* The model is good at reading headers and bad at noticing that a column of
   24-character hex strings is a database id rather than a product name. These
   look at the values instead of the label, and can overrule it. */
const ID_RE = /^[0-9a-f]{16,}$|^[0-9a-f]{8}-[0-9a-f]{4}-/i;
const looksLikeId = vals => {
  const v = vals.filter(Boolean);
  if (!v.length) return false;
  return v.filter(x => ID_RE.test(String(x).trim())).length / v.length > 0.6;
};
const looksLikeMoney = vals => {
  const v = vals.map(x => parseFloat(String(x).replace(/[^0-9.\-]/g, ""))).filter(n => isFinite(n));
  return v.length >= vals.filter(Boolean).length * 0.7 && v.length > 0;
};
/* A product name has letters, usually a space, and varies row to row. */
const nameScore = (vals, header) => {
  const v = vals.filter(Boolean).map(String);
  if (!v.length) return -99;
  if (looksLikeId(v)) return -99;
  let s = 0;
  if (/name|title|desc|product|item/i.test(header)) s += 6;
  if (/handle|slug|id|sku|code|url|path|ref/i.test(header)) s -= 5;
  const letters = v.filter(x => /[a-z]{3}/i.test(x)).length / v.length;
  s += letters * 4;
  if (v.filter(x => /\s/.test(x)).length / v.length > 0.5) s += 3;
  const avg = v.reduce((a, x) => a + x.length, 0) / v.length;
  if (avg >= 6 && avg <= 60) s += 2; else s -= 2;
  if (v.filter(x => x.startsWith("/") || x.startsWith("http")).length / v.length > 0.4) s -= 8;
  return s;
};
/* Categories arrive as "/hoodies, /latest-drops" or "Apparel > Tops". Take
   something a person would recognise on a department tab. */
function cleanDept(raw) {
  let s = String(raw || "").trim();
  if (!s) return "";
  s = s.split(",")[0];                       // first of a list
  s = s.split(">").pop();                    // last of a breadcrumb
  s = s.replace(/^\/+|\/+$/g, "").split("/").pop();
  s = s.replace(/[-_]+/g, " ").trim();
  if (!s) return "";
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

let IMPORT = null;   /* { rows, headers, map, sample, source } */

function importView() {
  window.__ipick = () => $("impFile").click();
  drawImport();
}
function drawImport() {
  if (IMPORT && IMPORT.map) return drawMapping();
  $("cfgBody").innerHTML = `
    <div class="drop" id="idrop">
      <svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/><path d="M4 9h16M9 9v11"/></svg>
      <b>Bring your pricebook over</b>
      <span>A CSV or NAXML export from your current POS, a spreadsheet, or a distributor item file.
        Any column layout — the columns get worked out for you and shown for approval before
        anything is imported.</span>
      <button class="mini" onclick="__ipick()">Choose a file</button>
      <input type="file" id="impFile" accept=".csv,.tsv,.txt,.xml,.json" style="display:none">
    </div>
    <div id="impStat"></div>
    <div class="note">Nothing is written until you've seen the column mapping and the preview.
      Items already in your pricebook are matched on barcode and updated rather than duplicated.</div>`;
  const dz = $("idrop");
  ["dragenter", "dragover"].forEach(e => dz.addEventListener(e, ev => { ev.preventDefault(); dz.classList.add("over"); }));
  ["dragleave", "drop"].forEach(e => dz.addEventListener(e, ev => { ev.preventDefault(); dz.classList.remove("over"); }));
  dz.addEventListener("drop", ev => { const f = ev.dataTransfer.files[0]; if (f) readImport(f); });
  $("impFile").onchange = e => { const f = e.target.files[0]; if (f) readImport(f); };
}

async function readImport(file) {
  const st = $("impStat");
  const show = (m, tone) => st.innerHTML =
    `<div class="note" style="border-color:var(--${tone || "vfd-dim"});margin-top:13px">${m}</div>`;
  show(`Reading ${esc(file.name)}…`);
  let text = "";
  try { text = await file.text(); } catch (e) { return show("Couldn't read that file.", "void"); }

  let rows, headers, source = "csv";
  if (/^\s*<\?xml|<NAXML|<ItemMaintenance/i.test(text)) {
    source = "naxml";
    rows = parseNAXML(text);
    if (!rows.length) return show(`That looks like XML but no item records came out of it.
      A CSV export from the same system usually works.`, "void");
    headers = Object.keys(rows[0]);
    rows = rows.map(r => headers.map(h => r[h]));
  } else {
    const all = parseCSV(text);
    if (all.length < 2) return show("That file has no rows in it.", "void");
    headers = all[0].map(h => String(h).trim());
    rows = all.slice(1);
  }

  show(`Read <b>${rows.length}</b> row${rows.length === 1 ? "" : "s"}. Working out what the columns mean…`);
  const sample = rows.slice(0, 8);
  const colVals = headers.map((h, i) => rows.slice(0, 40).map(r => r[i]));
  const idCols = headers.map((h, i) => looksLikeId(colVals[i]));
  let map = null;
  try {
    const r = await callAI(`A retailer is importing their pricebook. Work out what each column holds.

Columns, with a note where the values are clearly database identifiers rather than anything a
customer would see:
${headers.map((h, i) => `${i}: "${h}"${idCols[i] ? "  ← values are ids, NOT a product name" : ""}`).join("\n")}

First rows:
${sample.map(r => r.map(c => String(c).slice(0, 28)).join(" | ")).join("\n")}

Return ONLY valid JSON, no prose or fences:
{"map":{"name":number|null,"upc":number|null,"price":number|null,"cost":number|null,
 "dept":number|null,"size":number|null,"packQty":number|null,"vendor":number|null,
 "group":number|null,"optName":number|null,"optValue":number|null},
 "note":string}

- Each value is the column index holding that field, or null if the file doesn't have it.
- "price" is what the customer pays. "cost" is what the store pays the supplier. If only one
  money column exists, decide from the header wording and the values which it is — retail is
  normally the larger of two.
- "upc" is a barcode: 8 to 14 digits. Do not map an internal item number or SKU to it.
- NEVER map a column of database ids, handles, slugs or URLs to "name". If the only text column is
  ids, return null for name and say so in the note.
- Exports from web shops repeat a product across several rows, one per size or colour. When you see
  that shape, map "group" to the column that is the same on every row of one product (a handle, a
  title, or a parent id), "optName" to the column naming the option ("Size", "Colour") and
  "optValue" to the column holding the value ("Large", "Black"). Those rows will be combined into
  one product with the options as choices, rather than twelve separate products.
- "note": one sentence on anything ambiguous you had to decide.`,
      { max_tokens: 700, kind: "import-map" });
    map = r.map || null;
    let note = r.note || null;
    /* Overrule a name column that is plainly a set of ids, and pick the best
       text column instead. This is the difference between a pricebook and a
       screen full of hex. */
    if (map && (map.name == null || idCols[map.name])) {
      const scored = headers.map((h, i) => ({ i, s: nameScore(colVals[i], h) }))
        .sort((a, b) => b.s - a.s);
      if (scored[0] && scored[0].s > 0) {
        note = `The column picked for the product name held database ids, so "${
          headers[scored[0].i]}" was used instead — check the preview.`;
        map.name = scored[0].i;
      }
    }
    IMPORT = { rows, headers, map, sample, source, note, file: file.name, idCols };
  } catch (e) {
    IMPORT = { rows, headers, map: guessMap(headers, colVals), sample, source,
               note: "Columns were matched by name — check them.", file: file.name, idCols };
  }
  drawMapping();
}

/* Fallback if the model call fails: match on header wording alone. */
function guessMap(headers, colVals) {
  const find = re => { const i = headers.findIndex(h => re.test(h)); return i < 0 ? null : i; };
  const best = colVals
    ? headers.map((h, i) => ({ i, s: nameScore(colVals[i], h) })).sort((a, b) => b.s - a.s)[0]
    : null;
  return {
    name: (best && best.s > 0) ? best.i : find(/desc|item|product|name|title/i),
    upc: find(/upc|barcode|ean|scan/i),
    price: find(/variant price|retail|price|sell/i), cost: find(/cost|whsl|wholesale/i),
    dept: find(/dept|categ|class|collection|type/i), size: find(/size|pack.?size|volume/i),
    packQty: find(/pack.?qty|case.?qty|units/i), vendor: find(/vendor|supplier|manuf|brand/i),
    group: find(/handle|parent|style/i),
    optName: find(/option.?1.?name|option name/i),
    optValue: find(/option.?1.?value|option value|^size$|colou?r/i)
  };
}

/* NAXML is the Conexxus c-store standard. Different vendors nest it differently,
   so rather than assume a shape we walk for the elements that always appear. */
function parseNAXML(xml) {
  const out = [];
  const blocks = xml.match(/<(ItemInfo|Item|ProductRecord|ItemMaintenance)\b[\s\S]*?<\/\1>/gi) || [];
  const tag = (b, names) => {
    for (const n of names) {
      const m = new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`, "i").exec(b);
      if (m) return m[1].replace(/<[^>]+>/g, "").trim();
    }
    return "";
  };
  blocks.forEach(b => {
    const name = tag(b, ["Description", "ItemDescription", "POSDescription", "LongDescription"]);
    if (!name) return;
    out.push({
      Description: name,
      UPC: tag(b, ["UPC", "ItemCode", "PrimaryUPC", "ScanCode"]),
      Price: tag(b, ["RegularSellPrice", "UnitPrice", "Price", "SellingPrice"]),
      Cost: tag(b, ["ActualCost", "UnitCost", "Cost", "WholesaleCost"]),
      Department: tag(b, ["MerchandiseCode", "DepartmentID", "Department", "CategoryID"]),
      Size: tag(b, ["ItemSize", "Size", "PackageSize"]),
      Vendor: tag(b, ["VendorID", "Vendor", "SupplierID"])
    });
  });
  return out;
}

const FIELDS = [["name", "Product name", true], ["upc", "Barcode"], ["price", "Retail price"],
  ["cost", "Cost"], ["dept", "Department"], ["size", "Size"], ["packQty", "Pack quantity"],
  ["vendor", "Vendor"]];

function drawMapping() {
  const { headers, rows, map, note, file } = IMPORT;
  window.__imap = (field, v) => { IMPORT.map[field] = v === "" ? null : +v; drawMapping(); };
  window.__icancel = () => { IMPORT = null; drawImport(); };
  window.__irun = runImport;

  const collapsed = collapseVariants(rows, map);
  const preview = collapsed.items.slice(0, 6);
  IMPORT.collapsed = collapsed;
  const priced = preview.filter(p => p.price > 0).length;
  const costed = preview.filter(p => p.cost > 0).length;

  $("cfgBody").innerHTML = `
    <div class="sect">Columns in ${esc(file)} — ${rows.length} rows${
      collapsed.variants ? `, ${collapsed.items.length} products` : ""}</div>
    ${collapsed.variants ? `<div class="verify ok2"><div class="vhead">
      ${collapsed.variants} products have size or colour options</div>
      <p>Rows that repeat the same product for each size are being folded into one product with the
        options as choices, rather than imported as separate items. The cashier picks the size at the
        till, and you can see which sizes sell.</p></div>` : ""}
    ${note ? `<div class="cbar"><span class="cdot" style="background:var(--info)"></span>${esc(note)}</div>` : ""}
    <table class="tbl"><thead><tr><th style="width:26%">Field</th><th style="width:34%">Column in your file</th>
      <th>First value</th></tr></thead><tbody>
    ${FIELDS.map(([k, label, req]) => `<tr>
      <td style="padding-left:9px">${label}${req ? ` <span style="color:var(--void)">*</span>` : ""}</td>
      <td><select onchange="__imap('${k}',this.value)">
        <option value="">— not in this file —</option>
        ${headers.map((h, i) => `<option value="${i}" ${map[k] === i ? "selected" : ""}>${esc(h)}</option>`).join("")}
      </select></td>
      <td style="padding-left:9px;color:var(--txt-2);font-size:12px">${
        map[k] != null && IMPORT.sample[0] ? esc(String(IMPORT.sample[0][map[k]] || "").slice(0, 40)) : "—"}</td>
    </tr>`).join("")}
    </tbody></table>

    <div class="sect">Preview</div>
    <table class="tbl"><thead><tr><th>Item</th><th>Barcode</th><th>Cost</th><th>Price</th>
      <th>Margin</th><th>Department</th><th>Options</th></tr></thead><tbody>
    ${preview.map(p => `<tr>
      <td style="padding-left:9px">${esc(p.n || "—")}</td>
      <td style="padding-left:9px" class="num">${esc(p.upc || "—")}</td>
      <td style="padding-left:9px" class="num">${p.cost ? money(p.cost) : "—"}</td>
      <td style="padding-left:9px" class="num">${money(p.price)}</td>
      <td style="padding-left:9px;color:var(--txt-2)">${p.cost > 0 ? marginOf(p.cost, p.price).toFixed(0) + "%" : "—"}</td>
      <td style="padding-left:9px;color:var(--txt-2)">${esc(p.deptName || "—")}</td>
      <td style="padding-left:9px;color:var(--info);font-size:12px">${
        p.opts && p.opts.length > 1 ? esc(p.opts.map(o => o.n).join(", ").slice(0, 40)) : "—"}</td>
    </tr>`).join("")}
    </tbody></table>

    <div class="cbar" style="display:block">
      ${map.price == null && map.cost != null
        ? `<b>No retail price column.</b> Prices will be set from cost at your ${CFG.pricing.margin}% margin.`
        : map.price == null && map.cost == null
        ? `<b style="color:var(--void)">Neither price nor cost is mapped.</b> Map at least one before importing.`
        : `${priced}/6 preview rows have a price, ${costed}/6 have a cost.`}
      ${map.dept == null ? `<br>No department column — everything lands in one department you pick below.` : ""}
    </div>

    ${map.dept == null ? `<div class="frm" style="margin-top:11px">
      <label>Put everything in<select id="impDept">${CFG.depts.filter(d => !d.fuel).map(d =>
        `<option value="${d.id}">${esc(d.n)}</option>`).join("")}</select></label></div>` : ""}

    <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
      <button class="mini ok" style="color:#0D1F18" onclick="__irun()"
        ${map.name == null || (map.price == null && map.cost == null) ? "disabled" : ""}>
        Import ${rows.length} item${rows.length === 1 ? "" : "s"}</button>
      <button class="mini" onclick="__icancel()">Start over</button>
    </div>
    <div class="note">Rows whose barcode already exists are updated in place. Rows with no usable name
      or price are skipped and counted, not guessed at.</div>`;
}

function buildRow(r, map) {
  const g = i => i == null ? "" : String(r[i] == null ? "" : r[i]).trim();
  const cost = numOf(g(map.cost)) || 0;
  let price = numOf(g(map.price)) || 0;
  if (!price && cost) price = priceFor(cost);
  const upcRaw = g(map.upc).replace(/\D/g, "");
  const size = g(map.size);
  const base = g(map.name);
  return {
    n: [base, size && !base.includes(size) ? size : ""].filter(Boolean).join(" ").trim(),
    upc: validUPC(upcRaw) || (upcRaw.length >= 8 ? upcRaw : ""),
    cost, price,
    deptName: cleanDept(g(map.dept)),
    vendor: g(map.vendor),
    groupKey: g(map.group),
    optName: g(map.optName),
    optValue: g(map.optValue)
  };
}

/* Web-shop exports carry one row per size, with the product name only on the
   first row of each group. Fill the gaps, then fold the sizes into one product
   with a set of choices — twelve rows of the same hoodie is one hoodie. */
function collapseVariants(rows, map) {
  const built = rows.map(r => buildRow(r, map));
  if (map.group != null) {
    let lastName = "", lastDept = "", lastKey = "";
    built.forEach(b => {
      if (b.groupKey) lastKey = b.groupKey; else b.groupKey = lastKey;
      if (b.n) lastName = b.n; else b.n = lastName;
      if (b.deptName) lastDept = b.deptName; else b.deptName = lastDept;
    });
  }
  const canGroup = map.group != null && map.optValue != null;
  if (!canGroup) return { items: built.filter(b => b.n), variants: 0 };

  const byKey = new Map();
  built.forEach(b => {
    if (!b.n) return;
    const k = b.groupKey || b.n;
    if (!byKey.has(k)) byKey.set(k, { ...b, opts: [], _rows: 0 });
    const g = byKey.get(k);
    g._rows++;
    if (b.optValue && !g.opts.some(o => o.n === b.optValue))
      g.opts.push({ n: b.optValue, p: +(b.price - (byKey.get(k).price || 0)).toFixed(2) });
    /* Cheapest variant becomes the base price; dearer ones carry the difference. */
    if (b.price > 0 && (!g.price || b.price < g.price)) g.price = b.price;
    if (b.cost > 0 && (!g.cost || b.cost < g.cost)) g.cost = b.cost;
    if (b.upc && !g.upc) g.upc = b.upc;
  });
  const items = [...byKey.values()].map(g => {
    g.opts = g.opts.map(o => ({ n: o.n, p: 0 }));
    g.optLabel = built.find(b => b.optName)?.optName || "Size";
    return g;
  });
  return { items, variants: items.filter(g => g.opts.length > 1).length };
}

async function runImport() {
  const { rows, map } = IMPORT;
  const fallbackDept = $("impDept") ? $("impDept").value : CFG.depts.find(d => !d.fuel)?.id;

  /* Departments in the file are text. Map them onto real departments, creating
     any that don't exist, so a 40-department file doesn't land in one bucket. */
  const deptNames = [...new Set((IMPORT.collapsed || collapseVariants(rows, map)).items
    .map(b => b.deptName).filter(Boolean))].slice(0, 40);
  const deptMap = {};
  deptNames.forEach(n => {
    const hit = CFG.depts.find(d => !d.fuel && d.n.toLowerCase() === n.toLowerCase());
    if (hit) deptMap[n] = hit.id;
  });
  const unknown = deptNames.filter(n => !deptMap[n]);
  if (unknown.length) {
    const general = CFG.taxRates[0].id;
    unknown.forEach(n => {
      const d = { id: "D" + uid(), n, taxId: general, food: false,
        color: PALETTE[CFG.depts.length % PALETTE.length] };
      CFG.depts.push(d);
      CFG.menus.push({ id: "M" + d.id, n: d.n, color: d.color, keys: [] });
      deptMap[n] = d.id;
    });
  }

  let added = 0, updated = 0, skipped = 0, withOpts = 0;
  const byUpc = new Map(CFG.plus.filter(p => p.upc).map(p => [p.upc, p]));
  const items = (IMPORT.collapsed || collapseVariants(rows, map)).items;
  items.forEach(b => {
    if (!b.n || !(b.price > 0)) { skipped++; return; }
    /* A set of sizes becomes a required choice, so nothing is rung without one. */
    let modId = null;
    if (b.opts && b.opts.length > 1) {
      CFG.modGroups = CFG.modGroups || [];
      const label = `${b.optLabel || "Size"} — ${b.n}`.slice(0, 60);
      const grp = { id: "MG" + uid(), n: b.optLabel || "Size", required: true, multi: false,
        opts: b.opts.slice(0, 20) };
      CFG.modGroups.push(grp);
      modId = grp.id; withOpts++;
    }
    const deptId = (b.deptName && deptMap[b.deptName]) || fallbackDept;
    const ex = b.upc ? byUpc.get(b.upc) : null;
    if (ex) {
      ex.price = b.price;
      if (b.cost) ex.cost = b.cost;
      if (b.vendor) ex.vendor = b.vendor;
      updated++;
      return;
    }
    const plu = { id: "P" + uid(), upc: b.upc, n: b.n, price: b.price, cost: b.cost || null,
      deptId, weighed: false, ebt: false, deposit: null, restrictId: null,
      modIds: modId ? [modId] : [],
      vendor: b.vendor || "", upcSrc: b.upc ? "import" : null };
    CFG.plus.push(plu);
    if (plu.upc) byUpc.set(plu.upc, plu);
    const m = CFG.menus.find(x => x.id === "M" + deptId);
    if (m && m.keys.length < 60) m.keys.push({ pluId: plu.id });
    added++;
  });

  IMPORT = null;
  MENU = 0; reload(); TAB = "pricebook"; drawConfig();
  toast(`Imported <b>${added}</b> item${added === 1 ? "" : "s"}` +
    `${withOpts ? `, <b>${withOpts}</b> with size options` : ""}` +
    `${updated ? `, updated <b>${updated}</b>` : ""}` +
    `${unknown.length ? `, created <b>${unknown.length}</b> department${unknown.length === 1 ? "" : "s"}` : ""}` +
    `${skipped ? `. <b>${skipped}</b> row${skipped === 1 ? "" : "s"} skipped for no name or price` : ""}.`);
}
