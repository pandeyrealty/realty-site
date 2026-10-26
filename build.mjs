// Builds the static site into ./public from ./src templates, ./data/site.json, and ./listings/*/listing.json.
// Run locally with:  node build.mjs     (Vercel runs it automatically on every push)
import fs from "node:fs";
import path from "node:path";

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(ROOT, "public");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const usd = (n) => "$" + Number(n).toLocaleString("en-US");
const fill = (tpl, vars) => tpl.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));

const site = JSON.parse(read("data/site.json"));
const team = JSON.parse(read("data/team.json"));
const founder = team.find((m) => m.founder) || team[0];
const memberUrl = (m) => (m.founder ? "/founder" : `/team/${m.slug}`);
const CSS = read("src/shared.css");
const SHARED_JS = read("src/shared.js");
const STATUS = { active: ["For sale", "active-listing"], pending: ["Pending", "active-listing"], sold: ["Sold", "sold-listing"], coming: ["Coming soon", "active-listing"] };

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.cpSync(path.join(ROOT, "src/assets"), path.join(OUT, "assets"), { recursive: true });

// ---------- Shared partials ----------
const HEAD_COMMON = `<link rel="icon" href="/assets/favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,700;12..96,800&family=Figtree:wght@400;500;600;700&display=swap">
<meta name="theme-color" content="#0f1d33">`;

const licLine = site.licenses.map(([k, v]) => `<span>${esc(k)} <b>${esc(v)}</b></span>`).join("");
const socials = Object.entries(site.social).map(([k, v]) => `<a href="${esc(v)}" target="_blank" rel="noopener">${esc(k)}</a>`).join("");
const FOOTER = `<footer><div class="wrap">
  <div class="top">
    <a href="/"><img class="logo" src="/assets/logo.png" alt="Pandey Realty" loading="lazy"></a>
    <div class="soc">${socials}<a href="${esc(site.zillowUrl)}" target="_blank" rel="noopener">Zillow</a></div>
  </div>
  <div style="color:var(--on-navy)"><b>${esc(site.company)}</b> · ${esc(site.tagline)} · ${esc(site.office)} · <a href="tel:${site.phoneHref}">${esc(site.phone)}</a></div>
  <div class="lic">${licLine}</div>
  <div class="eho"><svg width="34" height="34" viewBox="0 0 40 40" aria-hidden="true"><path d="M20 4 3 16h4v18h26V16h4z" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M13 22h14M13 27h14" stroke="currentColor" stroke-width="2.4"/></svg><span><b style="color:var(--on-navy)">Equal Housing Opportunity.</b> Pandey Realty is committed to compliance with all federal, state, and local fair housing laws.</span></div>
  <div>Mortgage information on this site is not a commitment to lend or an offer to extend credit. All loans are subject to credit approval, underwriting, and property eligibility; terms and programs may change without notice. NMLS Consumer Access: <a href="https://www.nmlsconsumeraccess.org/" target="_blank" rel="noopener">nmlsconsumeraccess.org</a>. California DRE license lookup: <a href="https://www2.dre.ca.gov/publicasp/pplinfo.asp" target="_blank" rel="noopener">dre.ca.gov</a>.</div>
  <div style="display:flex;flex-wrap:wrap;gap:8px 20px"><span>© ${new Date().getFullYear()} ${esc(site.company)}</span><a href="/privacy">Privacy policy</a><a href="/terms">Terms of use</a><a href="/home-value">Home valuation</a><a href="/mortgage">Mortgage Center</a><a href="/calculators">Calculators</a></div>
</div></footer>`;

const memberCard = (m, brk) => `<aside class="agent">
  <img class="agent-logo" src="/assets/logo.png" alt="Pandey Realty" loading="lazy">
  <div class="who"><img class="avatar" src="${esc(m.photo)}" alt="${esc(m.name)}" loading="lazy"><div><p class="name"><a href="${memberUrl(m)}" style="color:inherit;text-decoration:none">${esc(m.name)}</a></p><p class="role">${esc(m.role)}<br>${esc(site.company)}</p></div></div>
  <div class="line"><div><small>Call or text</small><a href="tel:${esc(m.phoneHref)}">${esc(m.phone)}</a></div></div>
  <div class="line"><div><small>Email</small><a href="mailto:${esc(m.email)}">${esc(m.email)}</a></div></div>
  ${m.emailMortgage ? `<div class="line"><div><small>Mortgage</small><a href="mailto:${esc(m.emailMortgage)}">${esc(m.emailMortgage)}</a></div></div>` : ""}
  ${m.preapprovalUrl ? `<a class="btn gold" href="${esc(m.preapprovalUrl)}" target="_blank" rel="noopener">Secure pre-approval application</a>` : ""}
  <div class="lic">${m.licenses.map(([k, v]) => `<span>${esc(m.name)} · ${esc(k)} ${esc(v)}</span>`).join("")}${brk ? `<span><b>Listing brokerage:</b> ${esc(brk.name)}${brk.license ? ` · CA DRE #${esc(brk.license)}` : ""}</span>` : ""}<span>${esc(site.company)} · CA DRE Corp. #02446715 · NMLS #2877353</span></div>
</aside>`;
const companyCard = (withPreapproval = true) => `<aside class="agent">
  <img class="agent-logo" src="/assets/logo.png" alt="Pandey Realty" loading="lazy" style="width:190px">
  <div class="who"><div><p class="name">${esc(site.company)}</p><p class="role">Real estate brokerage &amp; mortgage<br>${esc(site.tagline)}</p></div></div>
  <div class="line"><div><small>Call or text</small><a href="tel:${site.phoneHref}">${esc(site.phone)}</a></div></div>
  <div class="line"><div><small>Real estate</small><a href="mailto:${esc(site.emailRealEstate)}">${esc(site.emailRealEstate)}</a></div></div>
  <div class="line"><div><small>Mortgage</small><a href="mailto:${esc(site.emailMortgage)}">${esc(site.emailMortgage)}</a></div></div>
  <div class="line"><div><small>Office</small>${esc(site.office)}</div></div>
  ${withPreapproval ? `<a class="btn gold" href="${esc(site.preapprovalUrl)}" target="_blank" rel="noopener">Secure pre-approval application</a>` : ""}
  <div class="lic"><span>CA DRE Corporation #02446715</span><span>NMLS #2877353</span></div>
</aside>`;
const COMPANY_CARD = companyCard(true);
const TEAM_CARDS = team.map((m) => `<a class="tcard" href="${memberUrl(m)}"><img src="${esc(m.photo)}" alt="${esc(m.name)}" loading="lazy"><div class="tb"><b>${esc(m.name)}</b><span>${esc(m.role)}</span><small>${m.licenses.map(([k, v]) => `${esc(k)} ${esc(v)}`).join(" · ")}</small><i>${m.founder ? "Meet our founder →" : "View profile →"}</i></div></a>`).join("");

function leadForm(topics, { showWhen = false, showLoan = true, label = "I'd like help with", submitLabel = "Send message", placeholder = "Tell me a bit about what you're looking for." } = {}) {
  return `<form class="form" id="leadForm" novalidate>
  <div class="field"><div class="fl"><span>${esc(label)}</span></div>
    <div class="seg" id="topic" role="group" aria-label="Request type">${topics.map((t, i) => `<button type="button" data-v="${esc(t)}" aria-pressed="${i === 0}">${esc(t)}</button>`).join("")}</div></div>
  <div class="row2">
    <div class="field"><label for="fName">Full name <span class="req">*</span></label><input type="text" id="fName" autocomplete="name" required maxlength="100"></div>
    <div class="field"><label for="fPhone">Phone <span class="req">*</span></label><input type="tel" id="fPhone" autocomplete="tel" required maxlength="30"></div>
  </div>
  <div class="field"><label for="fEmail">Email <span class="req">*</span></label><input type="email" id="fEmail" autocomplete="email" required maxlength="150"></div>
  ${showWhen ? `<div class="row2" id="whenRow">
    <div class="field"><label for="fDate">Preferred date</label><input type="date" id="fDate"></div>
    <div class="field"><label for="fTime">Preferred time</label><select id="fTime"><option value="">Any time</option><option>Morning</option><option>Afternoon</option><option>Evening</option></select></div>
  </div>` : ""}
  <div class="field"><label for="fMsg">Message</label><textarea id="fMsg" maxlength="2000" placeholder="${esc(placeholder)}"></textarea></div>
  ${showLoan ? `<label class="check"><input type="checkbox" id="fLoan"> I'd also like help getting pre-approved for a loan.</label>` : ""}
  <label class="check"><input type="checkbox" id="fConsent" required> I agree that Pandey Realty may contact me by phone, text, or email about my inquiry. Consent is not a condition of purchasing any property or obtaining financing. Message and data rates may apply.</label>
  <div class="hp" aria-hidden="true"><label for="fWeb">Website</label><input type="text" id="fWeb" tabindex="-1" autocomplete="off"></div>
  <div class="status" id="fStatus" role="status" hidden></div>
  <button class="btn gold" type="submit" id="fSubmit">${esc(submitLabel)}</button>
  <p class="fine">Please don't include Social Security numbers, account numbers, or other sensitive financial details here. Your information goes only to Pandey Realty and its licensed team members and is used to respond to you. See our <a href="/privacy">privacy policy</a>.</p>
</form>`;
}

const NAV = `<header class="nav">
  <div class="wrap">
    <a class="brand" href="/"><img src="/assets/logo-sm.png" alt="" width="72" height="42"><span><b>Pandey Realty</b><small>Home easily, loan smoothly</small></span></a>
    <button class="menu-btn" id="menuBtn" aria-expanded="false" aria-controls="links">Menu</button>
    <nav class="links" id="links" aria-label="Site">
      <a href="/#listings">Listings</a><a href="/#services">Services</a><a href="/mortgage">Mortgage Center</a><a href="/calculators">Calculators</a><a href="/team">Our Team</a><a href="/founder">Founder</a><a href="/#contact">Contact</a>
      <a class="hv" href="/home-value">Find my home value</a>
      <a class="btn gold" href="${esc(site.preapprovalUrl)}" target="_blank" rel="noopener">Get pre-approved</a>
    </nav>
  </div>
</header>`;
const CTA_BAR = `<div class="cta-bar" id="ctaBar"><a class="btn ghost" href="tel:${site.phoneHref}">Call us</a><a class="btn gold" href="${esc(site.preapprovalUrl)}" target="_blank" rel="noopener">Get pre-approved</a></div>`;
const R = Number(site.calcRate || 7), r3 = (x) => String(Math.round(x * 1000) / 1000);
const RATE_VARS = { MARKET_RATE: r3(R), RATE_POINTS: r3(R - 0.5), RATE_INVEST: r3(R + 0.75), RATE_TEXT: `${R.toFixed(2)}%` };
const common = { ...RATE_VARS, NAV, CTA_BAR, COMPANY_CARD, TEAM_CARDS, CSS, SHARED_JS, HEAD_COMMON, FOOTER, AGENT_CARD: memberCard(founder), PREAPPROVAL: esc(site.preapprovalUrl), ZILLOW: esc(site.zillowUrl), PHONE_HREF: site.phoneHref };
const write = (rel, html) => { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, html); };

// ---------- Listings ----------
const listings = fs.readdirSync(path.join(ROOT, "listings"), { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(ROOT, "listings", d.name, "listing.json")))
  .map((d) => ({ dir: d.name, ...JSON.parse(read(`listings/${d.name}/listing.json`)) }))
  .filter((l) => l.status !== "draft")
  .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));

const listingTpl = read("src/listing.html");
for (const L of listings) { const [, pfx] = STATUS[L.status] || STATUS.active; L.url = `/${pfx}/${L.slug}`; }
for (const L of listings) {
  const [label, prefix] = STATUS[L.status] || STATUS.active;
  L.urlPath = `${prefix}/${L.slug}`;
  L.url = `/${L.urlPath}`;
  fs.cpSync(path.join(ROOT, "listings", L.dir, "photos"), path.join(OUT, L.urlPath, "photos"), { recursive: true });
  // PDF brochure made by tools/brochure.py (re-run it after changing a listing)
  const brochureSrc = path.join(ROOT, "listings", L.dir, "brochure.pdf");
  const brochureName = `${(L.shortAddress || L.address).replace(/[^A-Za-z0-9]+/g, "-")}-Brochure.pdf`;
  L.brochure = fs.existsSync(brochureSrc) ? `/${L.urlPath}/${brochureName}` : "";
  if (L.brochure) fs.copyFileSync(brochureSrc, path.join(OUT, L.urlPath, brochureName));
  const agent = team.find((m) => m.slug === L.agent) || founder;
  L.agentSlug = agent.slug;
  const priceTxt = L.showPrice !== false && L.price ? usd(L.price) : "";
  const canonical = `https://www.pandey.realty${L.url}`;
  const ogImg = `https://www.pandey.realty${L.url}/photos/${L.cardPhoto || "01.jpg"}`;
  const desc = `${L.type ? L.type + " " : ""}${label.toLowerCase()} at ${L.address}, ${L.city}, ${L.state} ${L.zip}. ${L.summary || ""} Listed by ${agent.name}, ${agent.licenses[0].join(" ")}, ${L.brokerage ? "with " + L.brokerage.name : "Pandey Realty"}.`.trim();
  const data = { ...L, dir: undefined };
  write(`${L.urlPath}/index.html`, fill(listingTpl, {
    ...common,
    AGENT_CARD: memberCard(agent, L.brokerage), PRESENTER_ORG: esc(L.brokerage ? L.brokerage.name : "Pandey Realty"), AGENT_NAME: esc(agent.name), AGENT_FIRST: esc(agent.name.split(" ")[0]), AGENT_PHOTO: esc(agent.photo), AGENT_PHONE_HREF: esc(agent.phoneHref), AGENT_URL: memberUrl(agent),
    LEAD_FORM: leadForm(["Schedule a showing", "Get more info", "Get pre-approved"], { showWhen: true, submitLabel: "Send request", placeholder: "Questions, how you plan to use the property, etc." }),
    TITLE: esc(`${L.shortAddress || L.address}, ${L.city} ${L.state}${priceTxt ? " | " + priceTxt : ""} | Pandey Realty`),
    OG_TITLE: esc(`${L.shortAddress || L.address}, ${L.city} ${L.state}: ${L.type || "Home"} ${label.toLowerCase()}`),
    DESCRIPTION: esc(desc), CANONICAL: canonical, OG_IMAGE: ogImg,
    SHORT_ADDRESS: esc(L.shortAddress || L.address), ADDRESS: esc(L.address), CITY: esc(L.city), STATE: esc(L.state), ZIP: esc(L.zip),
    KICKER: esc([L.type, L.neighborhood, `${L.city}, ${L.state}`].filter(Boolean).join(" · ")),
    CITY_LINE: esc(`${L.city}, ${L.state === "CA" ? "California" : L.state} ${L.zip}`),
    MORE_LISTINGS: (() => { const o = listings.filter((x) => x.status !== "sold" && x.slug !== L.slug); return o.length ? `<div class="more-l">${o.map((x) => `<a href="${x.url}"><img src="${x.url}/photos/${esc(x.cardPhoto || "01.jpg")}" alt="${esc(x.address)}" loading="lazy"><div class="mb">${x.showPrice !== false && x.price ? `<b>${usd(x.price)}</b>` : ""}<span>${esc(x.address)}, ${esc(x.city)}</span><span>${esc([x.beds && x.beds + " bd", x.baths && x.baths + " ba", x.sqft && x.sqft + " sq ft"].filter(Boolean).join(" · "))}</span><i>View this home →</i></div></a>`).join("")}</div>` : ""; })(),
    BROCHURE_BTN: L.brochure ? `<a href="${L.brochure}" target="_blank" rel="noopener">Print brochure (PDF)</a>` : `<button type="button" onclick="window.print()">Print brochure</button>`,
    STATUS_LABEL: esc(label), PRICE_HTML: priceTxt ? `<span class="price">${priceTxt}</span>` : "",
    PHOTO_COUNT: String(L.photos.length),
    STAT_COUNT: String(L.stats.length), STATS_HTML: L.stats.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join(""),
    ABOUT_TITLE: esc(L.about.title), ABOUT_LEAD: esc(L.about.lead),
    ABOUT_PARAS: (L.about.paragraphs || []).map((p) => `<p>${esc(p)}</p>`).join("\n"),
    ABOUT_MORE: (L.about.more || []).map((p) => `<p>${esc(p)}</p>`).join("\n"),
    HIGHLIGHTS: (L.about.highlights || []).map((h) => `<li><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>${esc(h)}</li>`).join(""),
    LOCATION_TEXT: esc(L.locationText || ""), MAP_Q: encodeURIComponent(`${L.address}, ${L.city}, ${L.state} ${L.zip}`),
    FACTS_NOTE: esc(L.factsNote || "Information deemed reliable but not guaranteed. Buyers should verify all information."),
    LISTING_JSON: JSON.stringify(data).replace(/</g, "\\u003c"),
  }));
}

// ---------- Listing storybooks (listings/<slug>/story.json → /<status>/<slug>/story) ----------
const storyTpl = read("src/story.html");
const CHECK_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>`;
for (const L of listings) {
  const sf = path.join(ROOT, "listings", L.dir, "story.json");
  if (!fs.existsSync(sf)) continue;
  const S = JSON.parse(fs.readFileSync(sf, "utf8"));
  L.story = `${L.url}/story`;
  const agent = team.find((m) => m.slug === L.agentSlug) || founder;
  // photo refs: 12 → original photo 12; "s12" → virtually staged version of photo 12
  const pic = (ref) => { const s = String(ref).startsWith("s"); const n = String(parseInt(String(ref).replace("s", ""), 10)).padStart(2, "0"); return { src: `${L.url}/photos/${s ? "staged/" : ""}${n}.jpg`, staged: s }; };
  const plate = ([ref, cap]) => { const p = pic(ref); return `<figure class="plate"><img src="${p.src}" alt="${esc(cap)}${p.staged ? ", virtually staged with AI" : ""}" loading="lazy">${p.staged ? `<span class="stg">Virtually staged · AI</span>` : ""}<figcaption>${esc(cap)}</figcaption></figure>`; };
  const anyStaged = S.chapters.some((c) => c.photos.some(([r]) => String(r).startsWith("s")));
  const CHAPTERS = S.chapters.map((c, i) => `<section class="chapter reveal" id="ch${i + 1}"><div class="wrap">
  <div class="ch-head"><span class="ch-num" aria-hidden="true">${i + 1}</span><span class="ch-kicker">Chapter ${i + 1} · ${esc(c.kicker)}</span><h2>${esc(c.title)}</h2></div>
  <div class="spread"><div class="prose">${c.paras.map((p) => `<p>${esc(p)}</p>`).join("")}</div><div class="plates">${c.photos.map(plate).join("")}</div></div>
  ${i === S.chapters.length - 1 && anyStaged && S.stagedNote ? `<p class="stg-note">${esc(S.stagedNote)}</p>` : ""}
</div></section>`).join("\n");
  const STOPS = S.stops.map((s, i) => `<li class="stop reveal"><span class="stop-n">${i + 1}</span><div class="stop-grid">
  <div class="stop-pics">${s.photos.map((r) => `<img src="${pic(r).src}" alt="${esc(s.room)}" loading="lazy">`).join("")}</div>
  <div><h3>${esc(s.room)}</h3><p class="what">${esc(s.text)}</p>
  <div class="take"><img src="${esc(agent.photo)}" alt=""><div><small>${esc(agent.name.split(" ")[0])}'s take</small><p>${esc(s.take)}</p></div></div></div>
</div></li>`).join("\n");
  const TOC = [...S.chapters.map((c, i) => `<li><a href="#ch${i + 1}"><span>${i + 1}</span>${esc(c.kicker)}</a></li>`), `<li><a href="#walk"><span>${S.chapters.length + 1}</span>The walk-through</a></li>`, `<li><a href="#take"><span>${S.chapters.length + 2}</span>My take</a></li>`].join("");
  const priceTxt = L.showPrice !== false && L.price ? usd(L.price) : "";
  const cover = pic(S.cover);
  write(`${L.urlPath}/story/index.html`, fill(storyTpl, {
    ...common,
    TITLE: esc(`${S.title} | ${L.shortAddress || L.address}, ${L.city} | Pandey Realty`),
    OG_TITLE: esc(`${S.title}: the story of ${L.shortAddress || L.address}, ${L.city}`),
    DESCRIPTION: esc(S.dek), CANONICAL: `https://www.pandey.realty${L.story}`,
    OG_IMAGE: `https://www.pandey.realty${cover.src}`, COVER_IMG: cover.src, COVER_ALT: esc(S.coverCaption || L.address),
    SHORT_ADDRESS: esc(L.shortAddress || L.address), CITY: esc(L.city), STATE: esc(L.state),
    STORY_TITLE: esc(S.title), STORY_DEK: esc(S.dek),
    AGENT_NAME: esc(agent.name), AGENT_FIRST: esc(agent.name.split(" ")[0]), AGENT_PHOTO: esc(agent.photo), AGENT_ROLE: esc(agent.role), AGENT_PHONE_HREF: esc(agent.phoneHref),
    AGENT_LIC: esc(agent.licenses.map(([k, v]) => `${k} ${v}`).join(" · ")),
    PRESENTER_ORG: esc(L.brokerage ? L.brokerage.name : "Pandey Realty"),
    TOC, CHAPTERS, STOPS, WALK_INTRO: esc(S.walkIntro),
    STANDOUTS: S.standouts.map((x) => `<li>${CHECK_SVG}${esc(x)}</li>`).join(""),
    CHECKS_INTRO: esc(S.checksIntro), CHECKS: S.checks.map(([t, d]) => `<div><dt>${esc(t)}</dt><dd>${esc(d)}</dd></div>`).join(""),
    CLOSING: esc(S.closing), LISTING_URL: L.url,
    PRICE_LINE: priceTxt ? `<b>${priceTxt}</b> · ` : "",
    FACTS_LINE: esc([L.type, L.beds && `${L.beds} bd`, L.baths && `${L.baths} ba`, L.sqft && `${L.sqft} sq ft`, `${L.address}, ${L.city}, ${L.state} ${L.zip}`].filter(Boolean).join(" · ")),
    FACTS_NOTE: esc(L.factsNote || "Information deemed reliable but not guaranteed."),
  }));
  // link the story from the listing page
  const lf = path.join(OUT, L.urlPath, "index.html");
  fs.writeFileSync(lf, fs.readFileSync(lf, "utf8").replace("{{STORY_BTN}}", `<a class="story-card" href="${L.story}"><img src="${cover.src}" alt="" loading="lazy"><span><small>New · The story of this home</small><b>${esc(S.title)}</b><span style="display:block;color:var(--muted);font-size:15px">Live a day here, then walk it room by room with ${esc(agent.name.split(" ")[0])}.</span></span><span class="go" aria-hidden="true">→</span></a>`));
}

// Listing pages can be served on their own domain (e.g. 767lemos.com), where "/" is the listing itself,
// so links back to the company homepage must be absolute.
for (const L of listings) {
  for (const f of [path.join(OUT, L.urlPath, "index.html"), path.join(OUT, L.urlPath, "story", "index.html")]) {
    if (!fs.existsSync(f)) continue;
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("{{STORY_BTN}}", "").replaceAll('href="/"', 'href="https://www.pandey.realty/"').replaceAll('href="/#', 'href="https://www.pandey.realty/#'));
  }
}

// ---------- Homepage ----------
const active = listings.filter((l) => l.status !== "sold");
const feat = active[0];
const SHOW_FEATURED = false; // homepage hero shows the logo, not a featured listing
const HERO_FEATURE = SHOW_FEATURED && feat
  ? `<a class="feature" href="${feat.url}"><img class="fimg" src="${feat.url}/photos/${esc(feat.cardPhoto || "01.jpg")}" alt="${esc(feat.address)}" fetchpriority="high"><span class="ftag">Featured listing</span><span class="fcard">${feat.showPrice !== false && feat.price ? `<b>${usd(feat.price)}</b>` : ""}<span>${esc(feat.address)}, ${esc(feat.city)}</span><i>View this home →</i></span></a>`
  : `<div class="feature logo"><img src="/assets/logo.png" alt="Pandey Realty" style="width:100%;height:auto"></div>`;
const LISTING_CARDS = active.length
  ? `<div class="lcards${active.length === 1 ? " solo" : ""}">${active.map((L) => {
      const [label] = STATUS[L.status] || STATUS.active;
      return `<a class="lcard" href="${L.url}">
  <div class="ph"><img src="${L.url}/photos/${esc(L.cardPhoto || "01.jpg")}" alt="${esc(L.address)}" loading="lazy"><span class="pill ${esc(L.status)}">${esc(label)}</span></div>
  <div class="body">${L.showPrice !== false && L.price ? `<div class="price">${usd(L.price)}</div>` : ""}
    <div class="addr">${esc(L.address)}</div><div class="city">${esc([L.neighborhood, `${L.city}, ${L.state} ${L.zip}`].filter(Boolean).join(" · "))}</div>
    <div class="facts">${[L.type && `<span><b>${esc(L.type)}</b></span>`, L.beds && `<span><b>${esc(L.beds)}</b> bd</span>`, L.baths && `<span><b>${esc(L.baths)}</b> ba</span>`, L.sqft && `<span><b>${esc(L.sqft)}</b> sq ft</span>`].filter(Boolean).join("")}</div>
    ${active.length === 1 && L.summary ? `<p style="margin:8px 0 0;color:var(--muted)">${esc(L.summary)}</p>` : ""}<span class="go">View this home →</span></div></a>`;
    }).join("")}</div>`
  : `<div class="lempty">New listings are coming soon. <a href="#contact">Tell me what you're looking for</a> and I'll send homes that fit.</div>`;
const soldItems = [
  ...listings.filter((l) => l.status === "sold").map((l) => [l.address, `${l.city}, ${l.state}`, l.soldPrice || l.price, l.url]),
  ...site.sold,
];
const SOLD = soldItems.map(([a, c, p, u]) => `<div><small>Sold</small><b>${usd(p)}</b><span>${u ? `<a href="${u}">${esc(a)}</a>` : esc(a)}</span><i>${esc(c)}</i></div>`).join("");
const REVIEWS = site.reviews.map(([q, who]) => `<figure><blockquote>“${esc(q)}”</blockquote><figcaption><span>${esc(who)}</span><a href="${esc(site.zillowUrl)}" target="_blank" rel="noopener">Read on Zillow</a></figcaption></figure>`).join("");
// Homepage is written as home.html (not index.html) so vercel.json can show a listing at "/" on a listing domain.
write("home.html", fill(read("src/home.html"), {
  ...common, LISTING_CARDS, SOLD, REVIEWS, HERO_FEATURE,
  AREAS: site.areas.map((a) => `<span>${esc(a)}</span>`).join(""),
  LICENSES: site.licenses.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join(""),
  LEAD_FORM: leadForm(["Buying a home", "Selling a home", "Financing or refinancing", "Investment property", "Not sure yet"]),
}));

// ---------- Other pages ----------
const FOUNDER_STATS = (founder.stats || []).map(([v, k]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("");
const FOUNDER_LICENSES = founder.licenses.map(([k, v]) => `<div><dt>${esc(founder.name)} · ${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("");
const pageForms = {
  join: leadForm(["Join as an agent", "Join as a loan officer", "Other"], { showLoan: false, label: "I'm interested in", submitLabel: "Send my info", placeholder: "Your license type and number, years of experience, and what you're looking for." }),
};
for (const page of ["mortgage", "calculators", "privacy", "terms", "founder", "team", "join", "home-value"]) {
  const src = `src/${page}.html`;
  if (!fs.existsSync(path.join(ROOT, src))) continue;
  write(`${page}/index.html`, fill(read(src), {
    ...common,
    REVIEWS, FOUNDER_STATS, FOUNDER_LICENSES, COMPANY_CARD: companyCard(page !== "join"),
    LEAD_FORM: pageForms[page] || leadForm(["Get pre-approved", "Purchase loan", "Refinance", "Investment loan", "General question"], { placeholder: "What are you trying to do? No sensitive details, please." }),
  }));
}

// ---------- sitemap + vercel routing ----------
// ---------- Team member profile pages (non-founder) ----------
const memberTpl = fs.existsSync(path.join(ROOT, "src/member.html")) ? read("src/member.html") : null;
for (const m of team.filter((x) => !x.founder)) {
  if (!memberTpl) break;
  const theirs = listings.filter((l) => l.agentSlug === m.slug);
  write(`team/${m.slug}/index.html`, fill(memberTpl, {
    ...common, AGENT_CARD: memberCard(m),
    NAME: esc(m.name), ROLE: esc(m.role), PHOTO: esc(m.photo), SUMMARY: esc(m.summary || ""), SLUG: m.slug,
    BIO: (m.bio || []).map((b) => `<p>${esc(b)}</p>`).join(""),
    LANGS: (m.languages || []).map((x) => `<span>${esc(x)}</span>`).join(""),
    LISTINGS: theirs.map((L) => `<a href="${L.url}">${esc(L.address)}, ${esc(L.city)}</a>`).join("") || "<span>No active listings right now.</span>",
    LEAD_FORM: leadForm(["Buying a home", "Selling a home", "Financing or refinancing", "Other"]),
  }));
}
const urls = ["/", "/home-value", "/mortgage", "/calculators", "/team", "/founder", "/join", ...team.filter((m) => !m.founder).map((m) => `/team/${m.slug}`), ...listings.map((l) => l.url), ...listings.filter((l) => l.story).map((l) => l.story)];
write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>https://www.pandey.realty${u}</loc></url>`).join("")}</urlset>\n`);
write("robots.txt", "User-agent: *\nAllow: /\nSitemap: https://www.pandey.realty/sitemap.xml\n");
console.log(`Built ${listings.length} listing(s): ${listings.map((l) => l.url).join(", ")}`);
