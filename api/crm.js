// /api/crm: the CRM's only server endpoint. GET ?a=data returns what the signed-in person may see;
// POST {a: "<action>", ...} signs in/out or changes a record. Session = signed, HttpOnly cookie.
const crm = require("../lib/crm");

const COOKIE = "crm_s";
const readCookie = (req) => {
  const m = String(req.headers.cookie || "").match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : "";
};
const setCookie = (res, token, maxAge) => {
  const secure = process.env.CRM_LOCAL_DB ? "" : "; Secure";
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`);
};

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  try {
    if (req.method === "GET") {
      // Health check: confirms storage works (creates the database on first run). Reveals no data.
      if (new URL(req.url, "http://x").searchParams.get("a") === "health") { await crm.health(); return res.status(200).json({ ok: true, storage: "ready" }); }
      const s = await crm.sessionUser(readCookie(req));
      if (!s) return res.status(401).json({ ok: false, error: "Please sign in." });
      return res.status(200).json({ ok: true, ...crm.dataFor(s.db, s.u) });
    }
    if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); return res.status(405).json({ ok: false, error: "Method not allowed" }); }
    // Only our own page can call this: it always sends this header (browsers block it cross-site without CORS).
    if (req.headers["x-crm"] !== "1") return res.status(403).json({ ok: false, error: "Forbidden" });
    let b = req.body;
    if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
    b = b && typeof b === "object" ? b : {};
    const a = String(b.a || "");

    if (a === "login") {
      const { token, user } = await crm.login(b.username, b.password);
      setCookie(res, token, crm.SESSION_DAYS * 86400);
      return res.status(200).json({ ok: true, mustChange: !!user.mustChange });
    }
    if (a === "logout") { setCookie(res, "", 0); return res.status(200).json({ ok: true }); }

    const s = await crm.sessionUser(readCookie(req));
    if (!s) return res.status(401).json({ ok: false, error: "Please sign in again." });
    const { db, u, result } = await crm.change(s.u.id, a, b);
    if (result && result.newSession) setCookie(res, crm.sign({ u: u.id, sv: u.sv, exp: Date.now() + crm.SESSION_DAYS * 864e5 }), crm.SESSION_DAYS * 86400);
    return res.status(200).json({ ok: true, id: typeof result === "string" ? result : null, ...crm.dataFor(db, u) });
  } catch (err) {
    if (err instanceof crm.HttpError) return res.status(err.status).json({ ok: false, error: err.message });
    console.error("CRM error", err);
    return res.status(500).json({ ok: false, error: "Something went wrong. Please try again." });
  }
};
