// CRM storage: one private JSON document in Vercel Blob (store "pandey-crm"), saved with ETag checks so two
// people saving at the same moment never overwrite each other (the second save retries on fresh data).
// A dated backup copy is written once per day. For local testing, set CRM_LOCAL_DB to a file path.

const fs = require("fs");
const crypto = require("crypto");

const KEY = "crm/db.json";
let blobMod;
const blob = async () => (blobMod ||= await import("@vercel/blob"));

class Conflict extends Error {}

async function load() {
  if (process.env.CRM_LOCAL_DB) {
    const f = process.env.CRM_LOCAL_DB;
    if (!fs.existsSync(f)) return { db: null, etag: null };
    const text = fs.readFileSync(f, "utf8");
    return { db: JSON.parse(text), etag: crypto.createHash("md5").update(text).digest("hex") };
  }
  const { get } = await blob();
  const r = await get(KEY, { access: "private", useCache: false });
  if (!r || r.statusCode !== 200 || !r.stream) return { db: null, etag: null };
  const text = await new Response(r.stream).text();
  return { db: JSON.parse(text), etag: r.blob.etag };
}

async function write(pathname, text, etag, create) {
  if (process.env.CRM_LOCAL_DB) {
    const f = pathname === KEY ? process.env.CRM_LOCAL_DB : process.env.CRM_LOCAL_DB + "." + pathname.replace(/\W+/g, "_");
    if (pathname === KEY) {
      const cur = fs.existsSync(f) ? crypto.createHash("md5").update(fs.readFileSync(f, "utf8")).digest("hex") : null;
      if ((create && cur) || (!create && cur !== etag)) throw new Conflict("changed");
    }
    fs.writeFileSync(f, text);
    return;
  }
  const { put } = await blob();
  const opts = { access: "private", contentType: "application/json", addRandomSuffix: false };
  if (etag && !create) { opts.allowOverwrite = true; opts.ifMatch = etag; }
  if (!etag && !create) opts.allowOverwrite = true; // backups
  try {
    await put(pathname, text, opts);
  } catch (err) {
    const name = (err && (err.name || err.constructor?.name)) || "";
    if (/Precondition|AlreadyExists|exists/i.test(name + " " + (err && err.message))) throw new Conflict("changed");
    throw err;
  }
}

// Read the database, let fn change it, save it. Retries when someone else saved in between.
// fn may return a value; mutate resolves to { db, result }.
async function mutate(fn, init) {
  for (let attempt = 0; attempt < 6; attempt++) {
    let { db, etag } = await load();
    const creating = !db;
    if (creating) db = init();
    const result = await fn(db);
    db.updatedAt = new Date().toISOString();
    try {
      await write(KEY, JSON.stringify(db), etag, creating);
    } catch (err) {
      if (err instanceof Conflict) { await new Promise((r) => setTimeout(r, 80 + Math.random() * 220)); continue; }
      throw err;
    }
    const day = new Date().toISOString().slice(0, 10);
    if (db.lastBackup !== day) {
      // Best effort: a dated copy, then remember it on the next save.
      write(`crm/backups/${day}.json`, JSON.stringify(db), null, false).catch(() => {});
      db.lastBackup = day;
      try { const fresh = await load(); if (fresh.db && fresh.db.lastBackup !== day) { fresh.db.lastBackup = day; await write(KEY, JSON.stringify(fresh.db), fresh.etag, false); } } catch {}
    }
    return { db, result };
  }
  throw new Error("Too many people saving at once. Please try again.");
}

async function read(init) {
  const { db } = await load();
  if (db) return db;
  return (await mutate(() => null, init)).db; // first visit creates the database
}

// TEMP diagnostics: compares what get() and head() report (metadata only, no contents).
async function diag() {
  const b = await blob();
  const out = { sdk: b.version || null, hasUseCache: true };
  try { const h = await b.head(KEY); out.head = { etag: h.etag, uploadedAt: h.uploadedAt, size: h.size, cacheControl: h.cacheControl }; } catch (e) { out.headErr = String(e && e.message); }
  for (const uc of [false, true]) {
    try { const r = await b.get(KEY, { access: "private", useCache: uc }); const t = r && r.stream ? await new Response(r.stream).text() : ""; let u = null; try { u = JSON.parse(t).updatedAt; } catch {} out["get_useCache_" + uc] = r ? { status: r.statusCode, etag: r.blob && r.blob.etag, size: t.length, updatedAt: u } : null; } catch (e) { out["getErr_" + uc] = String(e && e.message); }
  }
  try { const l = await b.list({ prefix: "crm/" }); out.list = l.blobs.map((x) => ({ p: x.pathname, size: x.size, at: x.uploadedAt })); } catch (e) { out.listErr = String(e && e.message); }
  return out;
}
module.exports = { mutate, read, diag };
