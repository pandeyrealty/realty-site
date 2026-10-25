// Vercel serverless function: receives contact / showing forms from pandey.realty and emails the lead via Resend.
// Environment variables (Vercel → Project → Settings → Environment Variables):
//   RESEND_API_KEY   (required)  Resend API key
//   LEAD_TO_EMAIL    (optional)  comma-separated recipients. Default: pandeyrealty7@gmail.com
//   LEAD_FROM_EMAIL  (optional)  verified sender, e.g. "Pandey Realty <leads@pandey.realty>"

const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEAM = require("../data/team.json");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  // Spam checks: hidden "website" field must stay empty; humans take more than a second.
  if (clean(body.website, 200) !== "" || Number(body.elapsed) < 1000) {
    return res.status(200).json({ ok: true });
  }

  const lead = {
    topic: clean(body.topic, 60) || "General inquiry",
    listing: clean(body.listing, 120),
    agent: clean(body.agent, 60),
    page: clean(body.page, 200),
    name: clean(body.name, 100),
    email: clean(body.email, 150),
    phone: clean(body.phone, 30),
    date: clean(body.date, 20),
    time: clean(body.time, 20),
    message: String(body.message ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, 2000),
    preapproval: body.preapproval === true,
    consent: body.consent === true,
  };

  if (!lead.name || !lead.phone || !EMAIL_RE.test(lead.email)) {
    return res.status(400).json({ ok: false, error: "Please enter your name, phone number, and a valid email." });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("RESEND_API_KEY is not set");
    return res.status(500).json({ ok: false, error: "Email is not configured yet." });
  }
  const recipients = (process.env.LEAD_TO_EMAIL || "pandeyrealty7@gmail.com").split(",").map((s) => s.trim()).filter(Boolean);
  // Also notify the listing agent (looked up from data/team.json, never from the request).
  const member = TEAM.find((m) => m.slug === lead.agent);
  if (member && member.email && !recipients.includes(member.email)) recipients.push(member.email);
  const from = process.env.LEAD_FROM_EMAIL || "Pandey Realty Website <onboarding@resend.dev>";

  const about = lead.listing || "pandey.realty";
  const rows = [
    ["Request", lead.topic],
    ["Property", lead.listing || "—"],
    ["Agent", member ? member.name : "—"],
    ["Name", lead.name],
    ["Phone", lead.phone],
    ["Email", lead.email],
    ["Preferred date", lead.date || "—"],
    ["Preferred time", lead.time || "—"],
    ["Wants pre-approval help", lead.preapproval ? "Yes" : "No"],
    ["Agreed to be contacted", lead.consent ? "Yes" : "No"],
    ["Message", lead.message || "—"],
    ["Sent from", lead.page || "—"],
  ];
  const submitted = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" });

  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#121a2b">
  <h2 style="margin:0 0 4px">New lead: ${esc(about)}</h2>
  <p style="margin:0 0 16px;color:#5b6577">${esc(lead.topic)} · ${esc(submitted)} PT</p>
  <table cellpadding="8" style="border-collapse:collapse">
    ${rows.map(([k, v]) => `<tr><td style="border-bottom:1px solid #e4e7ec;color:#5b6577;vertical-align:top;white-space:nowrap">${k}</td><td style="border-bottom:1px solid #e4e7ec;white-space:pre-wrap">${esc(v)}</td></tr>`).join("")}
  </table>
  <p style="margin-top:16px;color:#5b6577">Reply to this email to respond to ${esc(lead.name)} directly.</p>
</div>`;
  const text = `New lead: ${about} (${lead.topic})\nSubmitted ${submitted} PT\n\n` + rows.map(([k, v]) => `${k}: ${v}`).join("\n");

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: recipients,
        reply_to: lead.email,
        subject: `New lead – ${about}: ${lead.name} (${lead.topic})`,
        html,
        text,
      }),
    });
    if (!r.ok) {
      console.error("Resend error", r.status, await r.text());
      return res.status(502).json({ ok: false, error: "Could not send email." });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Lead send failed", err);
    return res.status(502).json({ ok: false, error: "Could not send email." });
  }
};
