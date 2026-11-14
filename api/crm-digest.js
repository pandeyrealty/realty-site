// Morning CRM email: each active person with an email gets their follow-ups (overdue + today),
// plus new website leads (broker/managers), closings in the next 7 days, and rate locks ending in 3 days.
// Run by Vercel Cron (see "crons" in vercel.json). Vercel sends "Authorization: Bearer <CRON_SECRET>".
// Manual run: GET /api/crm-digest with that header; add ?dry=1 to get counts without sending.
const store = require("../lib/crm-store");
const CFG = require("../lib/crm-config");

const TZ = "America/Los_Angeles";
const SITE = "https://www.pandey.realty";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dayKey = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d)); // YYYY-MM-DD in Pacific time
const timeOf = (d) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(d));
const shortDate = (d) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric" }).format(new Date(d));
const addDays = (key, n) => { const d = new Date(key + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const finished = (d) => CFG.WON.includes(d.stage) || CFG.LOST.includes(d.stage);
const tel = (p) => "tel:" + String(p || "").replace(/[^\d+]/g, "");

function build(db, u, today) {
  const sees = (c) => u.role === "broker" || u.canSeeAll || c.assignedTo === u.id || c.lo === u.id;
  const contact = (id) => db.contacts.find((c) => c.id === id);
  const tasks = db.tasks.filter((t) => !t.done && t.assignedTo === u.id && dayKey(t.due) <= today).sort((a, b) => a.due.localeCompare(b.due));
  const leads = u.role === "broker" || u.canSeeAll
    ? db.contacts.filter((c) => c.status === "New" && (!c.assignedTo || c.assignedTo === u.id))
    : db.contacts.filter((c) => c.status === "New" && c.assignedTo === u.id);
  const mine = db.deals.filter((d) => !finished(d) && (d.agentId === u.id || d.loId === u.id || (u.role === "broker" && !d.agentId && !d.loId)) && sees(contact(d.contactId) || {}));
  const closings = mine.filter((d) => d.closeDate && d.closeDate >= today && d.closeDate <= addDays(today, 7)).sort((a, b) => a.closeDate.localeCompare(b.closeDate));
  const locks = mine.filter((d) => d.lockExp && d.lockExp >= today && d.lockExp <= addDays(today, 3)).sort((a, b) => a.lockExp.localeCompare(b.lockExp));
  if (!tasks.length && !leads.length && !closings.length && !locks.length) return null;

  const overdue = tasks.filter((t) => dayKey(t.due) < today);
  const row = (main, sub, c) => `<tr><td style="padding:10px 0;border-top:1px solid #eee"><div style="font-weight:600;color:#111">${main}</div><div style="color:#666;font-size:14px">${sub}</div></td>
    <td style="padding:10px 0;border-top:1px solid #eee;text-align:right;white-space:nowrap">${c && c.phone ? `<a href="${esc(tel(c.phone))}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;border-radius:999px;padding:6px 12px;font-size:13px;font-weight:600">Call</a>` : ""}</td></tr>`;
  const section = (title, rows) => (rows.length ? `<h2 style="font-size:17px;margin:24px 0 4px;color:#111">${title}</h2><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rows.join("")}</table>` : "");
  const taskRows = tasks.map((t) => {
    const c = contact(t.contactId);
    const when = dayKey(t.due) < today ? `<span style="color:#b23b3b;font-weight:600">Overdue since ${esc(shortDate(t.due))}</span>` : esc(timeOf(t.due));
    return row(esc(t.title), `${esc(t.kind)} · ${when}${c ? ` · <a href="${SITE}/crm#contact/${c.id}" style="color:#86662a">${esc(c.name)}</a>` : ""}`, c);
  });
  const leadRows = leads.slice(0, 15).map((c) => row(`<a href="${SITE}/crm#contact/${c.id}" style="color:#111;text-decoration:none">${esc(c.name)}</a>`, `${esc(c.sourceDetail || c.source || "")}${c.assignedTo ? "" : " · <b>Unassigned</b>"}`, c));
  const dealRow = (d, label) => { const c = contact(d.contactId); return row(`${esc(c ? c.name : "Client")} · ${esc(d.type)}`, `${label} · ${esc(d.stage)}${d.property ? " · " + esc(d.property) : ""}`, c); };

  const first = String(u.name || "").split(" ")[0];
  const bits = [tasks.length && `${tasks.length} follow-up${tasks.length === 1 ? "" : "s"}${overdue.length ? ` (${overdue.length} overdue)` : ""}`, leads.length && `${leads.length} new lead${leads.length === 1 ? "" : "s"}`, closings.length && `${closings.length} closing${closings.length === 1 ? "" : "s"} this week`, locks.length && `${locks.length} rate lock${locks.length === 1 ? "" : "s"} ending`].filter(Boolean);
  const subject = `Today: ${bits.join(", ")}`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;padding:8px 4px;color:#111">
    <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#86662a;font-weight:700">Pandey Realty CRM</div>
    <h1 style="font-size:22px;margin:6px 0 2px">Good morning, ${esc(first)}</h1>
    <div style="color:#666;font-size:14px">${esc(new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric" }).format(new Date()))}</div>
    ${section("Follow-ups due", taskRows)}
    ${section("New leads", leadRows)}
    ${section("Rate locks ending soon", locks.map((d) => dealRow(d, "Lock ends " + esc(shortDate(d.lockExp + "T12:00:00Z")))))}
    ${section("Closing this week", closings.map((d) => dealRow(d, "Closes " + esc(shortDate(d.closeDate + "T12:00:00Z")))))}
    <p style="margin:28px 0 8px"><a href="${SITE}/crm" style="display:inline-block;background:#c9a45a;color:#111;text-decoration:none;border-radius:999px;padding:12px 22px;font-weight:700">Open the CRM</a></p>
    <p style="color:#999;font-size:12px">Sent every morning by your Pandey Realty CRM. Mark follow-ups done in the CRM and they won't appear here tomorrow.</p></div>`;
  const text = [`Good morning, ${first}. ${subject}.`, "", ...tasks.map((t) => `- ${t.title}${contact(t.contactId) ? " (" + contact(t.contactId).name + ")" : ""}`), "", `${SITE}/crm`].join("\n");
  return { subject, html, text };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ ok: false });
  const dry = new URL(req.url, "http://x").searchParams.get("dry") === "1";
  const today = dayKey(Date.now());
  const db = await store.read(() => null);
  if (!db) return res.status(200).json({ ok: true, sent: 0, note: "no CRM yet" });
  if (!dry && db.digestDay === today) return res.status(200).json({ ok: true, sent: 0, note: "already sent today" });

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.LEAD_FROM_EMAIL || "Pandey Realty <onboarding@resend.dev>";
  const results = [];
  for (const u of db.users.filter((x) => x.active && x.email && x.digest !== false)) {
    const msg = build(db, u, today);
    if (!msg) { results.push({ u: u.id, skipped: true }); continue; }
    if (dry || !apiKey) { results.push({ u: u.id, subject: msg.subject, dry: true }); continue; }
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [u.email], subject: msg.subject, html: msg.html, text: msg.text }),
      });
      results.push({ u: u.id, ok: r.ok, status: r.status });
      if (!r.ok) console.error("Digest email failed", u.id, r.status, await r.text());
    } catch (err) { console.error("Digest email error", u.id, err); results.push({ u: u.id, ok: false }); }
  }
  if (!dry) { try { await store.mutate((d) => { d.digestDay = today; return null; }, () => db); } catch (err) { console.error("Digest mark failed", err); } }
  return res.status(200).json({ ok: true, day: today, results });
};
