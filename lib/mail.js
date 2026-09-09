/* ===========================================================================
   Sending mail.

   No npm package: Node has fetch built in, and every provider worth using has a
   plain HTTPS API. Adding a dependency to make one POST request is how a small
   service ends up with four hundred transitive packages.

   Configure with three variables:

     MAIL_PROVIDER   resend | postmark | mailgun
     MAIL_KEY        the API key
     MAIL_FROM       the address it comes from, e.g. AI POS <hello@yourdomain>
     MAIL_DOMAIN     mailgun only

   With none of them set, send() reports that it isn't configured and the caller
   falls back to writing the link to the log. Recovery keeps working either way,
   which matters more than the mail getting through.
   =========================================================================== */

const cfg = () => ({
  provider: String(process.env.MAIL_PROVIDER || "").trim().toLowerCase(),
  key: String(process.env.MAIL_KEY || "").trim(),
  from: String(process.env.MAIL_FROM || "").trim(),
  domain: String(process.env.MAIL_DOMAIN || "").trim()
});

const configured = () => {
  const c = cfg();
  return !!(c.provider && c.key && c.from);
};

/* Why it isn't configured, in words rather than a boolean — a silent "no" here
   is the sort of thing that gets debugged at midnight. */
function whyNot() {
  const c = cfg();
  const missing = [];
  if (!c.provider) missing.push("MAIL_PROVIDER");
  if (!c.key) missing.push("MAIL_KEY");
  if (!c.from) missing.push("MAIL_FROM");
  if (c.provider === "mailgun" && !c.domain) missing.push("MAIL_DOMAIN");
  if (missing.length) return `not configured — missing ${missing.join(", ")}`;
  if (!["resend", "postmark", "mailgun"].includes(c.provider))
    return `unknown provider "${c.provider}" — use resend, postmark or mailgun`;
  return null;
}

async function send({ to, subject, text, html }) {
  const problem = whyNot();
  if (problem) return { sent: false, reason: problem };

  const c = cfg();
  let url, headers, body;

  if (c.provider === "resend") {
    url = "https://api.resend.com/emails";
    headers = { "Authorization": `Bearer ${c.key}`, "Content-Type": "application/json" };
    body = JSON.stringify({ from: c.from, to: [to], subject, text, html });

  } else if (c.provider === "postmark") {
    url = "https://api.postmarkapp.com/email";
    headers = { "X-Postmark-Server-Token": c.key, "Content-Type": "application/json",
      "Accept": "application/json" };
    body = JSON.stringify({ From: c.from, To: to, Subject: subject,
      TextBody: text, HtmlBody: html, MessageStream: "outbound" });

  } else {
    url = `https://api.mailgun.net/v3/${c.domain}/messages`;
    headers = { "Authorization": "Basic " + Buffer.from("api:" + c.key).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded" };
    body = new URLSearchParams({ from: c.from, to, subject, text, html }).toString();
  }

  /* A mail provider having a bad afternoon shouldn't hang a login page. */
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { method: "POST", headers, body, signal: ctrl.signal });
    const txt = await r.text();
    if (!r.ok) {
      /* Providers put the useful part in different places; show the raw reply
         rather than a tidy message that hides it. */
      return { sent: false, reason: `${c.provider} refused it (${r.status}): ${txt.slice(0, 300)}` };
    }
    return { sent: true, provider: c.provider };
  } catch (e) {
    return { sent: false,
      reason: e.name === "AbortError" ? `${c.provider} didn't answer in time` : e.message };
  } finally {
    clearTimeout(timer);
  }
}

/* The one message this sends. Plain text as well as HTML, because a reset mail
   that renders as a wall of markup in some client is a reset that didn't work. */
function resetEmail(link, storeName) {
  const who = storeName ? ` for ${storeName}` : "";
  return {
    subject: "Reset your AI POS password",
    text: `Somebody asked to reset the password on your AI POS account${who}.

Open this link to set a new one:
${link}

It works once and expires in thirty minutes. Using it signs out every device
currently signed into the account.

If this wasn't you, ignore this — your password hasn't changed.`,
    html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#E7E8E4">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
  style="background:#E7E8E4;padding:36px 16px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
  style="max-width:460px;background:#F3F3F0;border:1px solid #CFD2CC;border-radius:8px;
  font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<tr><td style="padding:30px 30px 0">
  <div style="font-size:20px;font-weight:600;color:#14181A;letter-spacing:-.02em">
    Reset your password</div>
  <div style="font-size:14.5px;color:#5C6467;line-height:1.6;margin-top:10px">
    Somebody asked to reset the password on your AI POS account${who}.</div>
</td></tr>
<tr><td style="padding:24px 30px 0">
  <a href="${link}" style="display:block;background:#14181A;color:#E7E8E4;text-decoration:none;
    padding:14px;border-radius:4px;text-align:center;font-size:15px;font-weight:500">
    Set a new password</a>
</td></tr>
<tr><td style="padding:20px 30px 0">
  <div style="font-size:13px;color:#7A8285;line-height:1.6">
    It works once and expires in thirty minutes. Using it signs out every device currently
    signed into the account.</div>
</td></tr>
<tr><td style="padding:18px 30px 30px">
  <div style="font-size:13px;color:#7A8285;line-height:1.6;padding-top:16px;
    border-top:1px solid #DDD9D1">
    If this wasn't you, ignore it — your password hasn't changed.</div>
</td></tr>
</table>
</td></tr></table></body></html>`
  };
}

module.exports = { send, configured, whyNot, resetEmail };
