// Pandey Realty CRM: accounts, sessions, permissions, and record changes.
// Roles: "broker" sees and manages everything (including agents' logins). "agent" sees only contacts
// assigned to them (as agent or loan officer), plus the unassigned lead pool if the broker allows it.

const crypto = require("crypto");
const store = require("./crm-store");
const CFG = require("./crm-config");

const now = () => new Date().toISOString();
const uid = (p) => p + "_" + crypto.randomBytes(6).toString("base64url");
const str = (v, max = 200) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, max);
const line = (v, max = 200) => str(v, max).replace(/[\r\n\t]+/g, " ");
const num = (v) => { const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) && String(v ?? "").trim() !== "" ? n : null; };
const oneOf = (v, list, dflt) => (list.includes(v) ? v : dflt);
const date = (v) => (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/.test(String(v || "")) ? String(v) : "");
const digits = (p) => String(p || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };

// ---------- passwords + sessions ----------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return "s1$" + salt.toString("base64url") + "$" + h.toString("base64url");
}
function checkPassword(pw, stored) {
  const [v, salt, h] = String(stored || "").split("$");
  if (v !== "s1" || !salt || !h) return false;
  const got = crypto.scryptSync(String(pw), Buffer.from(salt, "base64url"), 64, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(h, "base64url");
  return want.length === got.length && crypto.timingSafeEqual(got, want);
}
function passwordProblem(pw) {
  if (String(pw).length < 10) return "Use at least 10 characters.";
  if (String(pw).length > 200) return "That password is too long.";
  return "";
}
const SECRET = () => process.env.CRM_SECRET || (process.env.CRM_LOCAL_DB ? "local-dev-secret" : fail(500, "CRM is not configured (CRM_SECRET)."));
const SESSION_DAYS = 14;
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET()).update(body).digest("base64url");
  return body + "." + sig;
}
function unsign(token) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  const want = crypto.createHmac("sha256", SECRET()).update(body).digest("base64url");
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try { const p = JSON.parse(Buffer.from(body, "base64url").toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
}

// ---------- database ----------
function initDb() {
  const hash = process.env.CRM_BROKER_INIT_HASH || (process.env.CRM_LOCAL_DB ? hashPassword(process.env.CRM_LOCAL_PASSWORD || "local-password-123") : "");
  if (!hash) fail(500, "CRM is not configured (CRM_BROKER_INIT_HASH).");
  return {
    v: 1, createdAt: now(),
    users: [{
      id: uid("u"), username: "nayan", name: "Nayan Pandey", role: "broker", title: "Broker", slug: "nayan-pandey",
      email: "pandeyrealty7@gmail.com", phone: "(469) 407-5853", active: true, canSeeAll: true, canClaim: true,
      pass: hash, mustChange: true, sv: 1, createdAt: now(), lastLogin: "",
    }],
    contacts: [], deals: [], tasks: [], notes: [], fails: {},
  };
}
const brokerOf = (db) => db.users.find((u) => u.role === "broker" && u.active) || db.users[0];

// ---------- permissions ----------
const isBroker = (u) => u.role === "broker";
function seesContact(u, c) {
  if (isBroker(u) || u.canSeeAll) return true;
  if (c.assignedTo === u.id || c.lo === u.id) return true;
  return false;
}
const inPool = (c) => !c.assignedTo;
function visible(db, u) {
  const pool = !isBroker(u) && !u.canSeeAll && u.canClaim;
  const contacts = db.contacts.filter((c) => seesContact(u, c) || (pool && inPool(c)));
  const full = new Set(contacts.filter((c) => seesContact(u, c)).map((c) => c.id));
  const ids = new Set(contacts.map((c) => c.id));
  // Pool contacts (not yet claimed) show basic info only, no history.
  const shown = contacts.map((c) => (full.has(c.id) ? c : { id: c.id, name: c.name, source: c.source, status: c.status, types: c.types, createdAt: c.createdAt, assignedTo: "", pool: true }));
  return {
    contacts: shown,
    deals: db.deals.filter((d) => full.has(d.contactId) || d.agentId === u.id || d.loId === u.id),
    tasks: db.tasks.filter((t) => (t.contactId ? full.has(t.contactId) : false) || t.assignedTo === u.id),
    notes: db.notes.filter((n) => full.has(n.contactId)),
    _ids: ids,
  };
}
function publicUser(u, viewer) {
  if (isBroker(viewer)) {
    const { pass, sv, ...rest } = u;
    return rest;
  }
  return { id: u.id, name: u.name, title: u.title, active: u.active, role: u.role === "broker" ? "broker" : "agent" };
}
function needContact(db, u, id) {
  const c = db.contacts.find((x) => x.id === id);
  if (!c || !seesContact(u, c)) fail(404, "That contact was not found.");
  return c;
}
const activeUserId = (db, id) => (db.users.some((x) => x.id === id && x.active) ? id : "");
function handOff(db, c, from, to) {
  for (const d of db.deals) {
    if (d.contactId !== c.id || CFG.WON.includes(d.stage) || CFG.LOST.includes(d.stage)) continue;
    if (!d.agentId || d.agentId === from) d.agentId = to || "";
  }
}
function log(db, contactId, by, kind, text) {
  db.notes.push({ id: uid("n"), contactId, by, at: now(), kind, text: str(text, 4000) });
}

// ---------- field cleaning ----------
function cleanContact(b, u, db, existing) {
  const c = {
    name: line(b.name, 120),
    phone: line(b.phone, 40),
    phone2: line(b.phone2, 40),
    email: line(b.email, 150).toLowerCase(),
    address: line(b.address, 200),
    city: line(b.city, 80),
    types: (Array.isArray(b.types) ? b.types : []).filter((t) => CFG.CONTACT_TYPES.includes(t)),
    status: oneOf(b.status, CFG.STATUSES, existing?.status || "New"),
    temp: oneOf(b.temp, CFG.TEMPS, ""),
    source: line(b.source, 80),
    sourceDetail: line(b.sourceDetail, 200),
    language: line(b.language, 60),
    birthday: date(b.birthday).slice(0, 10),
    about: str(b.about, 4000),
    tags: line(b.tags, 200),
  };
  if (!c.name) fail(400, "Please enter a name.");
  if (c.email && !EMAIL_RE.test(c.email)) fail(400, "That email address doesn't look right.");
  // Who it's assigned to: the broker (or a see-all manager) can choose; agents keep their own.
  if (isBroker(u) || u.canSeeAll) {
    c.assignedTo = b.assignedTo ? activeUserId(db, b.assignedTo) : "";
    c.lo = b.lo ? activeUserId(db, b.lo) : "";
  } else {
    c.assignedTo = existing ? existing.assignedTo : u.id;
    c.lo = existing ? existing.lo : (b.lo ? activeUserId(db, b.lo) : "");
    if (!existing && /loan/i.test(u.title) && !/agent/i.test(u.title)) { c.lo = u.id; }
  }
  return c;
}
function cleanDeal(b, db, u, prevStage) {
  const type = oneOf(b.type, Object.keys(CFG.DEAL_TYPES), "");
  if (!type) fail(400, "Choose what kind of deal this is.");
  const stages = CFG.DEAL_TYPES[type].stages;
  const d = {
    type,
    stage: oneOf(b.stage, stages, stages.includes(prevStage) ? prevStage : stages[0]),
    property: line(b.property, 200),
    price: num(b.price),
    loanAmount: num(b.loanAmount),
    program: oneOf(b.program, CFG.LOAN_PROGRAMS, ""),
    rate: num(b.rate),
    lockExp: date(b.lockExp).slice(0, 10),
    closeDate: date(b.closeDate).slice(0, 10),
    commission: num(b.commission),
    lender: line(b.lender, 120),
    notes: str(b.notes, 2000),
  };
  if (isBroker(u) || u.canSeeAll) {
    if ("agentId" in b) d.agentId = b.agentId ? activeUserId(db, b.agentId) : "";
    if ("loId" in b) d.loId = b.loId ? activeUserId(db, b.loId) : "";
  }
  return d;
}
function cleanTask(b, db, u) {
  const t = {
    title: line(b.title, 200),
    kind: oneOf(b.kind, CFG.TASK_KINDS, "Call"),
    due: date(b.due),
    details: str(b.details, 2000),
  };
  if (!t.title) fail(400, "Please describe the follow-up.");
  if (!t.due) fail(400, "Please pick a due date.");
  t.assignedTo = isBroker(u) || u.canSeeAll ? activeUserId(db, b.assignedTo) || u.id : u.id;
  return t;
}

// ---------- actions ----------
async function login(username, password) {
  username = line(username, 60).toLowerCase();
  const { result } = await store.mutate((db) => {
    const f = (db.fails[username] ||= { n: 0, until: 0 });
    if (f.until > Date.now()) return { err: "Too many tries. Please wait 15 minutes and try again." };
    const u = db.users.find((x) => x.username === username && x.active);
    // Always run the hash check so a wrong username and a wrong password take the same time.
    const ok = checkPassword(password, u ? u.pass : "s1$AAAAAAAAAAAAAAAAAAAAAA$" + "A".repeat(86));
    if (!u || !ok) {
      f.n += 1;
      if (f.n >= 8) { f.until = Date.now() + 15 * 60 * 1000; f.n = 0; }
      return { err: "That username and password don't match." };
    }
    delete db.fails[username];
    u.lastLogin = now();
    return { user: u };
  }, initDb);
  if (result.err) fail(401, result.err);
  return { token: sign({ u: result.user.id, sv: result.user.sv, exp: Date.now() + SESSION_DAYS * 864e5 }), user: result.user };
}

async function sessionUser(token) {
  const p = unsign(token);
  if (!p) return null;
  const db = await store.read(initDb);
  const u = db.users.find((x) => x.id === p.u);
  if (!u || !u.active || u.sv !== p.sv) return null;
  return { u, db };
}

function dataFor(db, u) {
  const v = visible(db, u);
  delete v._ids;
  return {
    me: publicUser(u, { role: "broker" }),
    users: db.users.map((x) => publicUser(x, u)),
    config: CFG,
    ...v,
    serverTime: now(),
  };
}

// Every change goes through here. `op` is the action name, `b` the request body. Returns fresh data for the user.
async function change(userId, op, b) {
  const { db, result } = await store.mutate((db) => {
    const u = db.users.find((x) => x.id === userId && x.active);
    if (!u) fail(401, "Please sign in again.");
    const broker = isBroker(u);
    const manager = broker || u.canSeeAll;
    switch (op) {
      case "contact.save": {
        if (b.id) {
          const c = needContact(db, u, b.id);
          const before = { status: c.status, assignedTo: c.assignedTo };
          Object.assign(c, cleanContact(b, u, db, c), { updatedAt: now() });
          if (before.status !== c.status) log(db, c.id, u.id, "System", `Status changed from ${before.status} to ${c.status}.`);
          if (before.assignedTo !== c.assignedTo) {
            handOff(db, c, before.assignedTo, c.assignedTo);
            const who = db.users.find((x) => x.id === c.assignedTo);
            log(db, c.id, u.id, "System", who ? `Assigned to ${who.name}.` : "Moved back to the unassigned lead pool.");
            if (who) db.tasks.push({ id: uid("t"), contactId: c.id, title: `Reach out to ${c.name} (newly assigned)`, kind: "Call", due: new Date(Date.now() + 3600e3).toISOString(), assignedTo: who.id, done: false, createdBy: u.id, createdAt: now() });
          }
          return c.id;
        }
        const c = { id: uid("c"), ...cleanContact(b, u, db), createdAt: now(), updatedAt: now(), createdBy: u.id };
        if (!c.source) c.source = "Other";
        db.contacts.push(c);
        log(db, c.id, u.id, "System", "Contact added.");
        return c.id;
      }
      case "contact.claim": {
        if (!u.canClaim && !manager) fail(403, "Ask the broker for access to the lead pool.");
        const c = db.contacts.find((x) => x.id === b.id);
        if (!c) fail(404, "That lead was not found.");
        if (c.assignedTo) fail(409, "Someone already took this lead.");
        c.assignedTo = u.id; c.updatedAt = now();
        handOff(db, c, "", u.id);
        for (const t of db.tasks) if (t.contactId === c.id && !t.done && t.createdBy === "website") t.assignedTo = u.id;
        log(db, c.id, u.id, "System", `Claimed by ${u.name}.`);
        return c.id;
      }
      case "contact.delete": {
        if (!broker) fail(403, "Only the broker can delete contacts.");
        const c = needContact(db, u, b.id);
        db.contacts = db.contacts.filter((x) => x !== c);
        db.deals = db.deals.filter((x) => x.contactId !== c.id);
        db.tasks = db.tasks.filter((x) => x.contactId !== c.id);
        db.notes = db.notes.filter((x) => x.contactId !== c.id);
        return null;
      }
      case "deal.save": {
        if (b.id) {
          const d = db.deals.find((x) => x.id === b.id);
          if (!d) fail(404, "That deal was not found.");
          const c = needContact(db, u, d.contactId);
          const before = d.stage;
          const keep = { agentId: d.agentId, loId: d.loId };
          Object.assign(d, keep, cleanDeal({ ...d, ...b }, db, u, before), { updatedAt: now() });
          if (before !== d.stage) log(db, c.id, u.id, "System", `${d.type}${d.property ? " · " + d.property : ""}: moved from ${before} to ${d.stage}.`);
          return d.id;
        }
        const c = needContact(db, u, b.contactId);
        const d = { id: uid("d"), contactId: c.id, agentId: c.assignedTo || "", loId: c.lo || "", ...cleanDeal(b, db, u), createdAt: now(), updatedAt: now(), createdBy: u.id };
        if (!d.agentId) d.agentId = c.assignedTo || "";
        if (!d.loId) d.loId = c.lo || "";
        if (!manager) {
          const loanish = CFG.DEAL_TYPES[d.type].group === "Mortgage";
          if (loanish && /loan/i.test(u.title)) d.loId = u.id; else d.agentId = d.agentId || u.id;
        }
        db.deals.push(d);
        log(db, c.id, u.id, "System", `New ${d.type} deal${d.property ? " for " + d.property : ""} (${d.stage}).`);
        if (["Lead", "New"].includes(c.status)) c.status = "Active";
        return d.id;
      }
      case "deal.delete": {
        const d = db.deals.find((x) => x.id === b.id);
        if (!d) fail(404, "That deal was not found.");
        needContact(db, u, d.contactId);
        if (!manager && d.createdBy !== u.id) fail(403, "Only the broker can delete this deal.");
        db.deals = db.deals.filter((x) => x !== d);
        log(db, d.contactId, u.id, "System", `Deleted ${d.type} deal${d.property ? " for " + d.property : ""}.`);
        return null;
      }
      case "task.save": {
        if (b.contactId) needContact(db, u, b.contactId);
        if (b.id) {
          const t = db.tasks.find((x) => x.id === b.id);
          if (!t || !(manager || t.assignedTo === u.id || (t.contactId && seesContact(u, db.contacts.find((c) => c.id === t.contactId) || {})))) fail(404, "That follow-up was not found.");
          Object.assign(t, cleanTask(b, db, u), { updatedAt: now() });
          return t.id;
        }
        const t = { id: uid("t"), contactId: b.contactId || "", dealId: line(b.dealId, 40), ...cleanTask(b, db, u), done: false, createdBy: u.id, createdAt: now() };
        db.tasks.push(t);
        return t.id;
      }
      case "task.done": {
        const t = db.tasks.find((x) => x.id === b.id);
        if (!t) fail(404, "That follow-up was not found.");
        if (!(manager || t.assignedTo === u.id || (t.contactId && seesContact(u, db.contacts.find((c) => c.id === t.contactId) || {})))) fail(404, "That follow-up was not found.");
        t.done = !!b.done; t.doneAt = t.done ? now() : ""; t.doneBy = t.done ? u.id : "";
        if (t.done && t.contactId) {
          log(db, t.contactId, u.id, t.kind === "Other" || t.kind === "Documents" || t.kind === "Showing" ? "Note" : t.kind, `Done: ${t.title}${b.outcome ? " · " + str(b.outcome, 1000) : ""}`);
          const c = db.contacts.find((x) => x.id === t.contactId);
          if (c) { c.lastTouch = now(); if (c.status === "New") c.status = "Contacted"; }
        }
        return t.id;
      }
      case "task.delete": {
        const t = db.tasks.find((x) => x.id === b.id);
        if (!t) fail(404, "That follow-up was not found.");
        if (!(manager || t.assignedTo === u.id || t.createdBy === u.id)) fail(403, "You can't delete this follow-up.");
        db.tasks = db.tasks.filter((x) => x !== t);
        return null;
      }
      case "note.add": {
        const c = needContact(db, u, b.contactId);
        const kind = oneOf(b.kind, CFG.LOG_KINDS, "Note");
        if (!str(b.text, 10)) fail(400, "Please write something first.");
        log(db, c.id, u.id, kind, b.text);
        if (kind !== "Note") { c.lastTouch = now(); if (c.status === "New") c.status = "Contacted"; }
        c.updatedAt = now();
        return c.id;
      }
      case "note.delete": {
        const n = db.notes.find((x) => x.id === b.id);
        if (!n || n.kind === "System") fail(404, "That note was not found.");
        needContact(db, u, n.contactId);
        if (!broker && n.by !== u.id) fail(403, "You can only delete your own notes.");
        db.notes = db.notes.filter((x) => x !== n);
        return null;
      }
      case "user.save": {
        if (!broker) fail(403, "Only the broker can manage logins.");
        const username = line(b.username, 40).toLowerCase();
        if (!/^[a-z0-9._-]{3,40}$/.test(username)) fail(400, "Usernames use 3–40 letters, numbers, dots, dashes, or underscores.");
        if (db.users.some((x) => x.username === username && x.id !== b.id)) fail(409, "That username is already taken.");
        const fields = {
          username, name: line(b.name, 100), title: line(b.title, 60) || "Agent", email: line(b.email, 150).toLowerCase(), phone: line(b.phone, 40),
          role: b.role === "broker" ? "broker" : "agent", canSeeAll: !!b.canSeeAll, canClaim: !!b.canClaim, slug: line(b.slug, 80),
        };
        if (!fields.name) fail(400, "Please enter the person's name.");
        if (b.id) {
          const x = db.users.find((y) => y.id === b.id);
          if (!x) fail(404, "That login was not found.");
          if (x.id === u.id && (fields.role !== "broker" || b.active === false)) fail(400, "You can't remove your own broker access.");
          const wasActive = x.active;
          Object.assign(x, fields, { active: b.active !== false, updatedAt: now() });
          if (b.password) {
            const p = passwordProblem(b.password); if (p) fail(400, p);
            x.pass = hashPassword(b.password); x.mustChange = true; x.sv += 1;
          }
          if (wasActive && !x.active) x.sv += 1; // signs them out everywhere
          return x.id;
        }
        const p = passwordProblem(b.password || ""); if (p) fail(400, "Starting password: " + p);
        const x = { id: uid("u"), ...fields, active: true, pass: hashPassword(b.password), mustChange: true, sv: 1, createdAt: now(), lastLogin: "" };
        db.users.push(x);
        return x.id;
      }
      case "account.password": {
        if (!checkPassword(b.current, u.pass)) fail(400, "Your current password isn't right.");
        const p = passwordProblem(b.next || ""); if (p) fail(400, p);
        if (b.next === b.current) fail(400, "Pick a new password that's different from the current one.");
        u.pass = hashPassword(b.next); u.mustChange = false; u.sv += 1;
        return { newSession: true };
      }
      default:
        fail(400, "Unknown action.");
    }
  }, initDb);
  const u = db.users.find((x) => x.id === userId);
  return { db, u, result };
}

// ---------- website leads ----------
// topic text from the website forms → which kind of deal to open.
function dealTypeFor(topic, listing, preapproval) {
  const t = String(topic || "").toLowerCase();
  const types = [];
  if (/sell|valuation|home value/.test(t)) types.push("Sell");
  else if (/refi/.test(t)) types.push("Refinance");
  else if (/invest.*loan/.test(t)) types.push("Investment loan (DSCR)");
  else if (/pre-approv|purchase loan|financ|mortgage/.test(t)) types.push("Purchase loan");
  else if (/buy|showing|tour|invest|listing|more info/.test(t) || listing) types.push("Buy");
  if (preapproval && !types.some((x) => CFG.DEAL_TYPES[x].group === "Mortgage")) types.push("Purchase loan");
  return types;
}
function typesFor(dealTypes, topic) {
  const out = new Set();
  for (const d of dealTypes) {
    if (d === "Buy") out.add("Buyer");
    if (d === "Sell") out.add("Seller");
    if (d === "Refinance") out.add("Refinance");
    if (CFG.DEAL_TYPES[d].group === "Mortgage") out.add("Borrower");
  }
  if (/invest/i.test(topic)) out.add("Investor");
  if (/join/i.test(topic)) out.add("Recruit");
  return [...out];
}

async function ingestLead(lead) {
  const { result } = await store.mutate((db) => {
    const broker = brokerOf(db);
    const owner = lead.agent ? db.users.find((x) => x.slug === lead.agent && x.active) : null;
    const email = String(lead.email || "").toLowerCase();
    const ph = digits(lead.phone);
    let c = db.contacts.find((x) => (email && x.email === email) || (ph.length >= 10 && digits(x.phone) === ph));
    const isJoin = /join/i.test(lead.topic);
    const dealTypes = isJoin ? [] : dealTypeFor(lead.topic, lead.listing, lead.preapproval);
    const fresh = !c;
    if (!c) {
      c = {
        id: uid("c"), name: line(lead.name, 120), phone: line(lead.phone, 40), phone2: "", email, address: "", city: "",
        types: typesFor(dealTypes, lead.topic), status: "New", temp: "Warm", source: "Website",
        sourceDetail: line(`${lead.topic}${lead.listing ? " · " + lead.listing : ""}`, 200), language: "", birthday: "", about: "", tags: "",
        assignedTo: owner ? owner.id : "", lo: "", consent: !!lead.consent, createdAt: now(), updatedAt: now(), createdBy: "website",
      };
      db.contacts.push(c);
    } else {
      for (const t of typesFor(dealTypes, lead.topic)) if (!c.types.includes(t)) c.types.push(t);
      if (["Closed", "Not interested"].includes(c.status)) c.status = "New";
      c.updatedAt = now();
    }
    const lines = [
      `Website form: ${lead.topic}${lead.listing ? " · " + lead.listing : ""}`,
      lead.date || lead.time ? `Preferred time: ${[lead.date, lead.time].filter(Boolean).join(" ")}` : "",
      lead.preapproval ? "Wants help getting pre-approved." : "",
      lead.message ? `Message: ${lead.message}` : "",
      lead.page ? `Page: ${lead.page}` : "",
    ].filter(Boolean);
    log(db, c.id, "website", "System", lines.join("\n"));
    for (const type of dealTypes) {
      const open = db.deals.find((d) => d.contactId === c.id && d.type === type && !CFG.WON.includes(d.stage) && !CFG.LOST.includes(d.stage) && (!lead.listing || d.property === lead.listing));
      if (!open) db.deals.push({
        id: uid("d"), contactId: c.id, type, stage: CFG.DEAL_TYPES[type].stages[0], property: line(lead.listing, 200),
        price: null, loanAmount: null, program: "", rate: null, lockExp: "", closeDate: "", commission: null, lender: "", notes: "",
        agentId: c.assignedTo || "", loId: c.lo || "", createdAt: now(), updatedAt: now(), createdBy: "website",
      });
    }
    db.tasks.push({
      id: uid("t"), contactId: c.id, title: `${fresh ? "Call new website lead" : "Follow up: website request"} – ${c.name}`, kind: "Call",
      due: new Date(Date.now() + 3600e3).toISOString(), details: lead.topic, assignedTo: c.assignedTo || broker.id, done: false, createdBy: "website", createdAt: now(),
    });
    return c.id;
  }, initDb);
  return result;
}

async function health() { await store.read(initDb); }

module.exports = { health, HttpError, login, sessionUser, dataFor, change, ingestLead, sign, SESSION_DAYS, isBroker };
