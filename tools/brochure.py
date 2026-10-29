#!/usr/bin/env python3
"""Build a print-ready PDF brochure for a listing.

Usage:  python3 tools/brochure.py <slug> [<slug> ...]
        python3 tools/brochure.py --all

Reads listings/<slug>/listing.json, listings/<slug>/photos/*.jpg, data/site.json and
data/team.json, and writes listings/<slug>/brochure.pdf. Re-run it whenever a listing's
price, text, or photos change, then commit the PDF.
"""
import json, math, os, sys, tempfile
from PIL import Image, ImageOps
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor, white
from reportlab.platypus import Paragraph, Frame, Table, TableStyle
from reportlab.lib.styles import ParagraphStyle
from reportlab.graphics.barcode import qr
from reportlab.graphics.shapes import Drawing
from reportlab.graphics import renderPDF

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS = os.path.join(ROOT, "tools", "fonts")
for name, file in [("Inter", "Inter-Regular"), ("Inter-Medium", "Inter-Medium"), ("Inter-SemiBold", "Inter-SemiBold"),
                   ("Inter-Bold", "Inter-Bold"), ("Display", "InterDisplay-Bold"), ("Display-XB", "InterDisplay-ExtraBold")]:
    pdfmetrics.registerFont(TTFont(name, os.path.join(FONTS, file + ".ttf")))

NAVY, FG, MUTED, LINE = HexColor("#0f1d33"), HexColor("#1c2230"), HexColor("#5d6370"), HexColor("#e7e2d7")
GOLD, GOLD_INK, GOLD_SOFT, IVORY = HexColor("#c9a45a"), HexColor("#86662a"), HexColor("#f4ecdb"), HexColor("#faf8f3")
ON_NAVY, ON_NAVY_MUTED = HexColor("#eef2f8"), HexColor("#a9b5c9")
W, H = letter
M = 40  # page margin

def esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def usd(n):
    return "${:,.0f}".format(n)

class Brochure:
    def __init__(self, slug):
        self.slug = slug
        self.dir = os.path.join(ROOT, "listings", slug)
        self.L = json.load(open(os.path.join(self.dir, "listing.json")))
        self.site = json.load(open(os.path.join(ROOT, "data", "site.json")))
        team = json.load(open(os.path.join(ROOT, "data", "team.json")))
        self.agent = next((m for m in team if m["slug"] == self.L.get("agent")), None) or next(m for m in team if m.get("founder"))
        self.tmp = tempfile.mkdtemp()
        self.n = 0
        dom = self.L.get("customDomain")
        prefix = "sold-listing" if self.L.get("status") == "sold" else "active-listing"
        self.url = f"https://{dom}" if dom else f"https://www.pandey.realty/{prefix}/{slug}"
        self.url_label = dom or f"pandey.realty/{prefix}/{slug}"
        self.page_no = 0

    # ---------- helpers ----------
    def photo(self, num):
        return os.path.join(self.dir, "photos", f"{int(num):02d}.jpg")

    def crop(self, num, w, h, focus_y=0.5):
        """Crop photo to the w:h box and save a JPEG sized for ~220 dpi print."""
        self.n += 1
        im = ImageOps.exif_transpose(Image.open(self.photo(num))).convert("RGB")
        tw, th = int(w * 220 / 72), int(h * 220 / 72)
        r = w / h
        iw, ih = im.size
        if iw / ih > r:
            nw = int(ih * r); x = (iw - nw) // 2; im = im.crop((x, 0, x + nw, ih))
        else:
            nh = int(iw / r); y = int((ih - nh) * focus_y); im = im.crop((0, y, iw, y + nh))
        if im.size[0] > tw:
            im = im.resize((tw, th), Image.LANCZOS)
        p = os.path.join(self.tmp, f"c{self.n}.jpg")
        im.save(p, quality=84, optimize=True, progressive=True)
        return p

    def img(self, c, num, x, y, w, h, radius=0, focus_y=0.5):
        self.used = getattr(self, "used", set()); self.used.add(int(num))
        p = self.crop(num, w, h, focus_y)
        if radius:
            c.saveState(); path = c.beginPath(); path.roundRect(x, y, w, h, radius); c.clipPath(path, stroke=0, fill=0)
            c.drawImage(p, x, y, w, h); c.restoreState()
        else:
            c.drawImage(p, x, y, w, h)

    def para(self, c, html, x, y_top, w, h, style):
        f = Frame(x, y_top - h, w, h, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, showBoundary=0)
        story = [Paragraph(p, style) for p in (html if isinstance(html, list) else [html])]
        left = f.addFromList(story, c)
        return left  # anything that didn't fit

    def footer(self, c, dark=False):
        self.page_no += 1
        col = ON_NAVY_MUTED if dark else MUTED
        txt = (f"{self.site['company']} · CA DRE Corp. #02446715 · NMLS #2877353 · {self.agent['name']}, "
               + " · ".join(f"{k} {v}" for k, v in self.agent["licenses"]) + " · Equal Housing Opportunity")
        size = 7.2
        while pdfmetrics.stringWidth(txt, "Inter", size) > W - 2 * M - 30 and size > 5.5:
            size -= 0.2
        c.setFont("Inter", size); c.setFillColor(col)
        c.drawString(M, 22, txt)
        c.setFont("Inter-SemiBold", 7.5); c.drawRightString(W - M, 22, str(self.page_no))

    def header(self, c, label):
        c.setFillColor(NAVY); c.rect(0, H - 54, W, 54, stroke=0, fill=1)
        logo = os.path.join(ROOT, "src", "assets", "logo.png")
        c.drawImage(logo, M, H - 46, 64, 64 * 376 / 640, mask="auto")
        c.setFillColor(white); c.setFont("Inter-SemiBold", 11)
        c.drawString(M + 76, H - 26, f"{self.L.get('shortAddress') or self.L['address']}, {self.L['city']}")
        c.setFillColor(ON_NAVY_MUTED); c.setFont("Inter", 9)
        c.drawString(M + 76, H - 39, label)
        if self.L.get("showPrice", True) and self.L.get("price"):
            c.setFillColor(GOLD); c.setFont("Display", 16); c.drawRightString(W - M, H - 33, usd(self.L["price"]))

    def eyebrow(self, c, text, x, y, color=GOLD_INK):
        c.setFont("Inter-Bold", 8); c.setFillColor(color)
        c.drawString(x, y, " ".join(text.upper()))  # letter-spaced look

    # ---------- pages ----------
    def cover(self, c):
        L = self.L
        photo_h = 476
        hero = (L.get("hero") or [[1, ""]])[0][0]
        self.img(c, hero, 0, H - photo_h, W, photo_h, focus_y=0.55)
        # gold status tag
        status = {"active": "For sale", "pending": "Pending", "sold": "Sold", "coming": "Coming soon"}.get(L.get("status"), "For sale")
        c.setFillColor(GOLD); c.roundRect(M, H - 62, 92, 24, 5, stroke=0, fill=1)
        c.setFillColor(NAVY); c.setFont("Inter-Bold", 9.5); c.drawCentredString(M + 46, H - 54, status.upper())
        # navy panel
        ph = H - photo_h
        c.setFillColor(NAVY); c.rect(0, 0, W, ph, stroke=0, fill=1)
        c.setFillColor(GOLD); c.rect(0, ph - 4, W, 4, stroke=0, fill=1)
        logo = os.path.join(ROOT, "src", "assets", "logo.png")
        c.drawImage(logo, W - M - 96, ph - 76, 96, 96 * 376 / 640, mask="auto")
        kicker = " · ".join(x for x in [L.get("type"), L.get("neighborhood"), f"{L['city']}, {L['state']}"] if x)
        self.eyebrow(c, kicker, M, ph - 36, GOLD)
        c.setFillColor(white); c.setFont("Display-XB", 40); c.drawString(M, ph - 82, L["address"])
        c.setFillColor(ON_NAVY_MUTED); c.setFont("Inter", 13)
        c.drawString(M, ph - 104, f"{L['city']}, {'California' if L['state'] == 'CA' else L['state']} {L['zip']}")
        if L.get("showPrice", True) and L.get("price"):
            c.setFillColor(GOLD); c.setFont("Display-XB", 30); c.drawString(M, ph - 146, usd(L["price"]))
        # stats row
        stats = [s for s in L.get("stats", []) if s[0].lower() != "price"][:5]
        y = 96; colw = (W - 2 * M) / max(1, len(stats))
        c.setStrokeColor(HexColor("#2a3a55")); c.setLineWidth(0.8); c.line(M, y + 44, W - M, y + 44)
        for i, (k, v) in enumerate(stats):
            x = M + i * colw
            if i: c.line(x, y - 2, x, y + 32)
            c.setFillColor(white); c.setFont("Display", 20); c.drawString(x + (0 if i == 0 else 14), y + 12, str(v))
            c.setFillColor(ON_NAVY_MUTED); c.setFont("Inter", 8.5); c.drawString(x + (0 if i == 0 else 14), y - 2, k.upper())
        # presenter
        c.setFillColor(ON_NAVY); c.setFont("Inter", 9.5)
        c.drawString(M, 50, f"Presented by {self.agent['name']} · {self.site['company']}  ·  {self.agent['phone']}  ·  {self.url_label}")
        self.footer(c, dark=True)
        c.showPage()

    def about(self, c):
        L, A = self.L, self.L.get("about", {})
        self.header(c, "About the home")
        top = H - 54 - 24
        # two photos
        hero = L.get("hero", [])
        picks = [h[0] for h in hero[1:4]] or [1, 2]
        pw = (W - 2 * M - 12) / 2; phh = 150
        self.img(c, picks[1] if len(picks) > 1 else picks[0], M, top - phh, pw, phh, radius=8)
        self.img(c, picks[2] if len(picks) > 2 else picks[0], M + pw + 12, top - phh, pw, phh, radius=8)
        y = top - phh - 30
        self.eyebrow(c, "About this home", M, y)
        title = ParagraphStyle("t", fontName="Display", fontSize=21, leading=25, textColor=NAVY)
        lead = ParagraphStyle("l", fontName="Inter-Medium", fontSize=11.2, leading=16, textColor=FG, spaceAfter=8)
        body = ParagraphStyle("b", fontName="Inter", fontSize=9.4, leading=13.6, textColor=FG, spaceAfter=6)
        colw = (W - 2 * M) * 0.60
        self.para(c, esc(A.get("title", "")), M, y - 10, colw + 40, 54, title)
        texts = [f'<font name="Inter-Medium" size="11.2">{esc(A.get("lead", ""))}</font>']
        texts += [esc(p) for p in A.get("paragraphs", []) + A.get("more", [])]
        f = Frame(M, 46, colw, y - 70 - 46, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        story = [Paragraph(texts[0], lead)] + [Paragraph(t, body) for t in texts[1:]]
        f.addFromList(story, c)
        self.overflow = story  # paragraphs that didn't fit continue on the details page
        # highlights box
        hx = M + colw + 20; hw = W - M - hx; hy_top = y - 66
        hl = A.get("highlights", [])
        hs = ParagraphStyle("h", fontName="Inter-Medium", fontSize=9.2, leading=11.5, textColor=FG)
        items = []
        for h in hl:
            p = Paragraph(esc(h), hs); _, ph2 = p.wrap(hw - 42, 60); items.append((p, ph2))
        box_h = 40 + sum(ph2 + 9 for _, ph2 in items)
        c.setFillColor(GOLD_SOFT); c.roundRect(hx, hy_top - box_h, hw, box_h, 8, stroke=0, fill=1)
        c.setFillColor(GOLD_INK); c.setFont("Inter-Bold", 8); c.drawString(hx + 14, hy_top - 20, " ".join("HIGHLIGHTS"))
        yy = hy_top - 34
        for p, ph2 in items:
            c.setFillColor(GOLD); c.circle(hx + 18, yy - 5.5, 2.6, stroke=0, fill=1)
            p.drawOn(c, hx + 28, yy - ph2); yy -= ph2 + 9
        self.footer(c); c.showPage()

    def gallery_pages(self, c):
        photos = self.L.get("photos", [])
        used = {h[0] for h in self.L.get("hero", [])[:4]}
        # spread picks across sections so every part of the home is shown
        sections = []
        for sec, cap, num in photos:
            if not sections or sections[-1][0] != sec:
                sections.append([sec, []])
            sections[-1][1].append((cap, num))
        want = 9   # one photo-tour page (3 x 3), so the brochure is 4 pages
        total = len(photos) or 1
        picks = []
        for sec, items in sections:
            k = max(1, round(want * len(items) / total))
            fresh = [it for it in items if it[1] not in used] or items
            seen_caps = set(); cand = []
            for it in fresh:  # prefer different captions within a section
                base = it[0].split(" · ")[0]
                if base not in seen_caps: cand.append(it); seen_caps.add(base)
            cand += [it for it in fresh if it not in cand]
            step = max(1, len(cand) / k)
            for i in range(k):
                it = cand[min(len(cand) - 1, int(i * step))]
                if it not in picks: picks.append(it)
        # no repeated room captions; top up with other rooms if needed
        out, caps = [], set()
        for it in picks:
            if it[0] not in caps: out.append(it); caps.add(it[0])
        for sec, items in sections:
            for it in items:
                if len(out) >= want: break
                if it[0] not in caps and it[1] not in used: out.append(it); caps.add(it[0])
        picks = out[:want]
        per, cols, gap, capgap = 9, 3, 12, 30
        for pg in range(math.ceil(len(picks) / per)):
            chunk = picks[pg * per:(pg + 1) * per]
            self.header(c, "Photo tour" + (f" · {pg + 1} of {math.ceil(len(picks) / per)}" if len(picks) > per else ""))
            top = H - 54 - 26
            gw = (W - 2 * M - (cols - 1) * gap) / cols; gh = (top - 86 - 3 * capgap) / 3
            for i, (cap, num) in enumerate(chunk):
                col, row = i % cols, i // cols
                x = M + col * (gw + gap); y = top - (row + 1) * gh - row * capgap
                self.img(c, num, x, y, gw, gh, radius=8)
                c.setFillColor(FG); c.setFont("Inter-SemiBold", 9.5); c.drawString(x + 2, y - 14, cap)
            self.footer(c); c.showPage()

    def details(self, c):
        L = self.L
        self.header(c, "Property details & contact")
        top = H - 54 - 30
        self.eyebrow(c, "Property details", M, top)
        rows = [("Address", f"{L['address']}, {L['city']}, {L['state']} {L['zip']}")]
        if L.get("showPrice", True) and L.get("price"): rows.append(("List price", usd(L["price"])))
        for k, v in [("Property type", L.get("type")), ("Neighborhood", L.get("neighborhood")), ("Bedrooms", L.get("beds")),
                     ("Bathrooms", L.get("baths")), ("Living area", f"{L['sqft']} sq ft" if L.get("sqft") else ""),
                     ("Lot size", L.get("lot")), ("Year built", L.get("yearBuilt"))]:
            if v: rows.append((k, str(v)))
        for k, v in L.get("stats", []):
            if k.lower() not in {r[0].lower() for r in rows} and k.lower() not in ("price", "built", "living area"):
                rows.append((k, str(v)))
        ks = ParagraphStyle("k", fontName="Inter", fontSize=9.5, leading=12, textColor=MUTED)
        vs = ParagraphStyle("v", fontName="Inter-SemiBold", fontSize=9.5, leading=12, textColor=FG)
        t = Table([[Paragraph(esc(k), ks), Paragraph(esc(v), vs)] for k, v in rows], colWidths=[110, 160])
        t.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.5, LINE), ("TOPPADDING", (0, 0), (-1, -1), 6),
                               ("BOTTOMPADDING", (0, 0), (-1, -1), 6), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
        tw, th = t.wrap(270, 500); t.drawOn(c, M, top - 12 - th)
        y_after = top - 12 - th
        # units (multi-unit listings)
        rx = M + 300; rw = W - M - rx; ry = top
        if L.get("units"):
            for u in L["units"]:
                self.eyebrow(c, u["tab"], rx, ry); ry -= 15
                c.setFillColor(NAVY); c.setFont("Inter-SemiBold", 10); c.drawString(rx, ry, u["title"]); ry -= 9
                rs = ParagraphStyle("r", fontName="Inter", fontSize=8.8, leading=11.4, textColor=FG)
                for name, desc in u.get("rooms", []):
                    p = Paragraph(f'<font name="Inter-SemiBold">{esc(name)}:</font> {esc(desc)}', rs)
                    _, h = p.wrap(rw, 60); p.drawOn(c, rx, ry - h); ry -= h + 3
                ry -= 14
        else:
            # one more photo in the right column
            extra = (L.get("hero") or [[1]])[-1][0]
            self.img(c, extra, rx, top - 4 - 200, rw, 200, radius=8)
            ry = top - 4 - 200 - 18
        # location
        loc_y = min(y_after, ry) - 26
        self.eyebrow(c, "Location", M, loc_y)
        ls = ParagraphStyle("lo", fontName="Inter", fontSize=9.6, leading=14, textColor=FG)
        lp = Paragraph(esc(L.get("locationText", "")), ls); _, lh = lp.wrap(W - 2 * M, 80); lp.drawOn(c, M, loc_y - 10 - lh)
        y = loc_y - 10 - lh - 16
        rest = [p for p in getattr(self, "overflow", [])]
        if rest:
            f = Frame(M, y - 120, W - 2 * M, 120, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
            f.addFromList(rest, c); y -= 120
        card_top = 150 - 40 + 168
        space = y - card_top - 18
        if space > 90:
            unused = [n for _, _, n in reversed(L.get("photos", [])) if n not in self.used]
            strip = (unused[:1] + unused[len(unused) // 3:len(unused) // 3 + 1]) if len(unused) > 1 else (unused or [1])
            sw = (W - 2 * M - 12) / len(strip)
            for i, num in enumerate(strip):
                self.img(c, num, M + i * (sw + 12), card_top + 18, sw, space, radius=8)
        # contact card
        cy = 150; ch = 168
        c.setFillColor(NAVY); c.roundRect(M, cy - 40, W - 2 * M, ch, 10, stroke=0, fill=1)
        head = os.path.join(ROOT, "src", self.agent["photo"].lstrip("/"))
        if os.path.exists(head):
            c.saveState(); p = c.beginPath(); p.circle(M + 62, cy + 50, 40); c.clipPath(p, stroke=0, fill=0)
            c.drawImage(head, M + 22, cy + 10, 80, 80, preserveAspectRatio=True, anchor="c"); c.restoreState()
            c.setStrokeColor(GOLD); c.setLineWidth(2); c.circle(M + 62, cy + 50, 40, stroke=1, fill=0)
        tx = M + 122
        self.eyebrow(c, "Schedule a showing", tx, cy + 98, GOLD)
        c.setFillColor(white); c.setFont("Display", 19); c.drawString(tx, cy + 74, self.agent["name"])
        c.setFillColor(ON_NAVY_MUTED); c.setFont("Inter", 9.2); c.drawString(tx, cy + 59, f"{self.agent['role']} · {self.site['company']}")
        c.setFillColor(white); c.setFont("Inter-SemiBold", 10.5)
        c.drawString(tx, cy + 37, self.agent["phone"]); c.drawString(tx, cy + 22, self.agent["email"])
        c.setFillColor(ON_NAVY_MUTED); c.setFont("Inter", 8.5)
        c.drawString(tx, cy + 4, " · ".join(f"{k} {v}" for k, v in self.agent["licenses"]))
        c.drawString(tx, cy - 9, f"{self.site['company']} · CA DRE Corp. #02446715 · NMLS #2877353")
        c.drawString(tx, cy - 22, self.site["office"])
        # QR code
        q = qr.QrCodeWidget(self.url); b = q.getBounds(); s = 92
        d = Drawing(s, s, transform=[s / (b[2] - b[0]), 0, 0, s / (b[3] - b[1]), 0, 0]); d.add(q)
        qx = W - M - 18 - s; qy = cy + 22
        c.setFillColor(white); c.roundRect(qx - 6, qy - 6, s + 12, s + 12, 6, stroke=0, fill=1)
        renderPDF.draw(d, c, qx, qy)
        c.setFillColor(ON_NAVY); c.setFont("Inter-SemiBold", 8.6); c.drawCentredString(qx + s / 2, qy - 20, "Scan for all photos,")
        c.drawCentredString(qx + s / 2, qy - 31, "video tour & calculator")
        # disclaimer
        ds = ParagraphStyle("d", fontName="Inter", fontSize=7, leading=9.4, textColor=MUTED)
        note = (L.get("factsNote", "") + " Information is deemed reliable but not guaranteed; buyers should verify all details "
                "independently. Pandey Realty is committed to compliance with all federal, state, and local fair housing laws.")
        self.para(c, esc(note.strip()), M, 98, W - 2 * M, 50, ds)
        self.footer(c); c.showPage()

    def build(self):
        out = os.path.join(self.dir, "brochure.pdf")
        c = canvas.Canvas(out, pagesize=letter, pageCompression=1)
        title = f"{self.L.get('shortAddress') or self.L['address']}, {self.L['city']} {self.L['state']} | {self.site['company']}"
        c.setTitle(title); c.setAuthor(f"{self.agent['name']}, {self.site['company']}"); c.setSubject("Property brochure")
        self.cover(c); self.about(c); self.gallery_pages(c); self.details(c)
        c.save()
        return out

if __name__ == "__main__":
    args = sys.argv[1:]
    if args == ["--all"]:
        args = sorted(d for d in os.listdir(os.path.join(ROOT, "listings"))
                      if os.path.exists(os.path.join(ROOT, "listings", d, "listing.json")))
    for slug in args:
        p = Brochure(slug).build()
        print(f"{slug}: {p} ({os.path.getsize(p) // 1024} KB)")
