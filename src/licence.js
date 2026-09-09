/* ===========================================================================
   Licence scanning and the electronic journal.

   Two things a convenience counter needs that a general POS doesn't ship with.
   =========================================================================== */

/* ============================ LICENCE SCANNING ============================
   The barcode on the back of a US or Canadian driver's licence is a PDF417
   holding an AAMVA record. Any 2D scanner reads it and types it out like a
   keyboard, which means no new hardware — the same scanner already on the
   counter can verify age.

   Why this matters more than it looks: a cashier pressing "verified" is a
   cashier's word. A parsed date of birth compared against the restriction is a
   record, and it's the difference between a defensible compliance position and
   an argument.

   The parser only reads what it needs — date of birth, expiry, and the state.
   Name and address are deliberately not stored. */

const AAMVA = {
  DBB: "dob", DBA: "expires", DBD: "issued",
  DCS: "family", DAC: "given", DAD: "middle",
  DBC: "sex", DAQ: "licence", DAJ: "state", DCG: "country"
};

/* Dates arrive as MMDDCCYY in the US and CCYYMMDD in Canada, and the header
   says which. Guessing wrong ages somebody by decades. */
function aamvaDate(raw, canadian) {
  const s = String(raw || "").replace(/\D/g, "");
  if (s.length !== 8) return null;
  const [y, m, d] = canadian
    ? [s.slice(0, 4), s.slice(4, 6), s.slice(6, 8)]
    : [s.slice(4, 8), s.slice(0, 2), s.slice(2, 4)];
  const dt = new Date(+y, +m - 1, +d);
  if (dt.getFullYear() !== +y || dt.getMonth() !== +m - 1 || dt.getDate() !== +d) return null;
  return dt;
}

function parseLicence(raw) {
  const text = String(raw || "");
  /* Every AAMVA record starts with a compliance indicator and "ANSI ". Without
     it this is some other barcode and shouldn't be treated as an ID. */
  if (!/ANSI\s?\d/.test(text) && !text.includes("@")) return null;

  /* Issuer numbers are not a reliable tell — Illinois is 636035 and Ontario is
     636012, so any "6360xx" rule reads a US licence as Canadian and shifts the
     date by a decade. The country field is the answer, with a short list of
     Canadian issuers for the older records that omit it. */
  const CANADIAN_IIN = ["636028","636012","636017","636049","636044","636013",
                        "636027","636059","636016","636062"];
  const iin = (/ANSI\s?(\d{6})/.exec(text) || [])[1] || "";
  const canadian = /DCG\s*CAN/i.test(text) || CANADIAN_IIN.includes(iin);
  const out = { canadian, raw: text.length };

  /* Fields are three-letter codes at the start of a line, and the value runs to
     the end of that line. Splitting on line breaks avoids building a character
     class by hand — an escaping slip there had the date of birth swallowing the
     three lines after it, which produced a nonsense age rather than an error. */
  text.split(String.fromCharCode(10)).forEach(rawLine => {
    const line = rawLine.replace(String.fromCharCode(13), "").trim();
    const code = line.slice(0, 3);
    const key = AAMVA[code];
    if (key && out[key] === undefined) out[key] = line.slice(3).trim();
  });

  out.dobDate = aamvaDate(out.dob, canadian);
  out.expiresDate = aamvaDate(out.expires, canadian);
  if (!out.dobDate) return null;

  const now = new Date();
  let age = now.getFullYear() - out.dobDate.getFullYear();
  const before = now.getMonth() < out.dobDate.getMonth()
    || (now.getMonth() === out.dobDate.getMonth() && now.getDate() < out.dobDate.getDate());
  if (before) age--;
  out.age = age;
  out.expired = out.expiresDate ? out.expiresDate < now : null;

  /* Nothing identifying is kept beyond this point — the caller gets the age and
     whether the licence is in date, and the names are dropped. */
  delete out.family; delete out.given; delete out.middle; delete out.licence;
  return out;
}

/* The scanner types a licence far faster than a person can, and the record runs
   to hundreds of characters across several lines. The barcode wedge collects
   short numeric bursts; this collects long ones and hands them over. */
let LIC_BUF = "", LIC_T = 0, LIC_WAIT = null;
function licenceWedge(e) {
  const now = Date.now();
  if (now - LIC_T > 120) LIC_BUF = "";
  LIC_T = now;
  if (e.key.length === 1) LIC_BUF += e.key;
  else if (e.key === "Enter") LIC_BUF += "\n";
  if (LIC_BUF.length > 4000) LIC_BUF = LIC_BUF.slice(-4000);

  clearTimeout(LIC_WAIT);
  LIC_WAIT = setTimeout(() => {
    if (LIC_BUF.length < 60) { LIC_BUF = ""; return; }
    const lic = parseLicence(LIC_BUF);
    LIC_BUF = "";
    if (lic && typeof onLicence === "function") onLicence(lic);
  }, 180);
}

/* What the age gate does when a licence arrives while it's open. */
let AGE_GATE = null;
function onLicence(lic) {
  if (!AGE_GATE) {
    /* Scanned with nothing waiting on it — still worth answering, because a
       cashier often checks before ringing. */
    return alertCard(lic.expired ? "That licence has expired" : `${lic.age} years old`,
      lic.expired
        ? `It expired ${lic.expiresDate.toLocaleDateString()}. An expired licence isn't valid ID.`
        : `Born ${lic.dobDate.toLocaleDateString()}. Old enough for anything you sell${
            lic.age >= 21 ? "" : " that's under " + (lic.age + 1) + "+"}.`);
  }
  AGE_GATE.scanned(lic);
}
