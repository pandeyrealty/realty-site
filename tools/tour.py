#!/usr/bin/env python3
"""Cinematic photo tour for a listing: slow camera moves, crossfades, room captions, branded end card.

  python3 tools/tour.py <slug>             -> listings/<slug>/tour.mp4 + tour.jpg (16:9, for the website)
  python3 tools/tour.py <slug> --vertical  -> listings/<slug>/tour-vertical.mp4 (9:16, for Reels/TikTok/Shorts)

Shots come from "tour": {"shots": [[photo#, "caption", "motion"?], ...]} in listing.json,
or default to the hero photos plus the first photos of each unit. Motions: in, out, left, right, up.
Uses the ORIGINAL photos (never AI-staged ones), so no AB 723 staging label is needed.
Adds original synthesized background music (tools/music.py); pass --silent for none.
Re-run after changing photos, then commit.
"""
import json, math, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
slug = sys.argv[1]
VERT = "--vertical" in sys.argv
W, H = (1080, 1920) if VERT else (1920, 1080)
FPS, D, T, END = 30, 3.4, 0.8, 4.5          # shot length, crossfade, end card seconds
S = W / 1920 if not VERT else 1.3   # text scale (bigger on phones)

LD = f"{ROOT}/listings/{slug}"
L = json.load(open(f"{LD}/listing.json"))
team = json.load(open(f"{ROOT}/data/team.json"))
site = json.load(open(f"{ROOT}/data/site.json"))
agent = next((m for m in team if m["slug"] == L.get("agent")), None) or next(m for m in team if m.get("founder"))
FONTS = f"{ROOT}/tools/fonts/"
F = lambda n, s: ImageFont.truetype(FONTS + n, int(s * S))
NAVY, GOLD, WHITE, MUTED = (15, 29, 51), (201, 164, 90), (255, 255, 255), (169, 181, 201)

# ---------- shot list ----------
cap = {p[2]: (p[0], p[1]) for p in L.get("photos", [])}
def label(n):
    g, c = cap.get(n, ("", ""))
    return f"{g.capitalize()} · {c}" if g.lower().endswith("unit") else c
shots = L.get("tour", {}).get("shots")
if shots:
    shots = [[s[0], s[1] if len(s) > 1 and s[1] else label(s[0]), s[2] if len(s) > 2 else None] for s in shots]
else:
    seen, nums = set(), [h[0] for h in L["hero"]] + [n for u in L.get("units", []) for n in u["photos"][:4]]
    shots = [[n, label(n), None] for n in nums if not (n in seen or seen.add(n))]
CYCLE = ["in", "right", "out", "left", "up"] if not VERT else ["right", "left", "in", "right", "left"]
for i, s in enumerate(shots):
    s[2] = s[2] or CYCLE[i % len(CYCLE)]

# ---------- motion ----------
def ease(t):  # gentle ease, never fully stops so crossfades keep moving
    return 0.55 * t + 0.45 * (0.5 - 0.5 * math.cos(math.pi * t))

def rect(img, motion, t):
    iw, ih = img.size; ar = W / H
    mw, mh = (iw, iw / ar) if iw / ih < ar else (ih * ar, ih)          # largest W:H box that fits
    e = ease(t)
    z = {"in": 1 + 0.16 * e, "out": 1.16 - 0.16 * e}.get(motion, 1.06 if VERT else 1.14)
    w, h = mw / z, mh / z
    cx, cy = iw / 2, ih / 2
    span_x, span_y = (iw - w) / 2, (ih - h) / 2
    k = 0.75 if VERT else 1.0
    if motion == "right": cx = iw / 2 + span_x * k * (2 * e - 1)
    if motion == "left":  cx = iw / 2 - span_x * k * (2 * e - 1)
    if motion == "up":    cy = ih / 2 - span_y * (2 * e - 1)
    return (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)

def text_w(d, s, f): return d.textlength(s, font=f)

# ---------- overlays (RGBA, built once) ----------
def caption_overlay(text):
    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(ov)
    f = F("Inter-Bold.ttf", 40); px, py = 28 * S, 16 * S
    bb = f.getbbox(text); tw, th = text_w(d, text, f), bb[3] - bb[1]
    x = 70 * S if not VERT else (W - tw) / 2 - px
    y = H - (110 * S if not VERT else 560 * S) - th - 2 * py
    d.rounded_rectangle([x, y, x + tw + 2 * px, y + th + 2 * py], radius=14 * S, fill=(255, 255, 255, 240))
    d.text((x + px, y + py - bb[1]), text, font=f, fill=NAVY)
    return ov

def title_overlay():
    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(ov)
    g0 = int(H * (0.45 if not VERT else 0.38))
    for y in range(g0, H):  # dark gradient at the bottom
        d.line([(0, y), (W, y)], fill=NAVY + (int(225 * min(1, (y - g0) / ((H - g0) * (1 if not VERT else 0.45)))),))
    lines = [(L.get("type", "").upper(), F("Inter-Bold.ttf", 30), GOLD),
             (L.get("shortAddress", L["address"]), F("InterDisplay-ExtraBold.ttf", 96), WHITE),
             (f'{L.get("neighborhood", "")} · {L["city"]}, {L["state"]}'.strip(" ·"), F("Inter-Medium.ttf", 40), WHITE),
             ("  ·  ".join(x for x in [L.get("beds") and f'{L["beds"]} bd', L.get("baths") and f'{L["baths"]} ba',
                                        L.get("sqft") and f'{L["sqft"]} sq ft'] if x), F("Inter-Medium.ttf", 34), MUTED)]
    y = H - (150 * S if not VERT else 520 * S)
    for txt, f, c in reversed(lines):
        bb = f.getbbox(txt); y -= (bb[3] - bb[1]) + 22 * S
        x = 70 * S if not VERT else (W - text_w(d, txt, f)) / 2
        d.text((x, y - bb[1]), txt, font=f, fill=c)
    return ov

def end_card(bg):
    im = bg.resize((W, H), Image.LANCZOS, box=rect(bg, "in", 0)).filter(ImageFilter.GaussianBlur(18)).convert("RGBA")
    im.alpha_composite(Image.new("RGBA", (W, H), NAVY + (225,)))
    d = ImageDraw.Draw(im)
    logo = Image.open(f"{ROOT}/src/assets/logo.png").convert("RGBA"); logo.thumbnail((int(420 * S), int(240 * S)), Image.LANCZOS)
    url = L.get("customDomain") or f"pandey.realty/active-listing/{L['slug']}"
    lic = " · ".join(f"{a} {b}" for a, b in agent["licenses"])
    rows = [("Schedule a private showing", F("InterDisplay-ExtraBold.ttf", 70), WHITE),
            (f'{agent["name"]}  ·  {agent["phone"]}', F("Inter-SemiBold.ttf", 46), GOLD),
            (url, F("Inter-Bold.ttf", 44), WHITE),
            (f"Pandey Realty, Inc. · DRE #02446715 · {agent['name']} {lic}", F("Inter-Regular.ttf", 24), MUTED),
            ("Equal Housing Opportunity · Information deemed reliable but not guaranteed", F("Inter-Regular.ttf", 24), MUTED)]
    if VERT:  # long lines wrap on a narrow frame
        rows[0:1] = [("Schedule a", rows[0][1], WHITE), ("private showing", rows[0][1], WHITE)]
        rows[4:5] = [("Pandey Realty, Inc. · DRE #02446715", rows[4][1], MUTED), (f"{agent['name']} {lic}", rows[4][1], MUTED)]
        rows[6:7] = [("Equal Housing Opportunity", rows[6][1], MUTED), ("Information deemed reliable but not guaranteed", rows[6][1], MUTED)]
    def fit(t, f):  # shrink any line wider than 90% of the frame
        while d.textlength(t, font=f) > W * 0.9: f = f.font_variant(size=f.size - 2)
        return f
    rows = [(t, fit(t, f), c) for t, f, c in rows]
    hs = [f.getbbox(t)[3] - f.getbbox(t)[1] for t, f, _ in rows]
    total = logo.height + 60 * S + sum(hs) + 34 * S * (len(rows) - 1) + 40 * S
    y = (H - total) / 2
    im.alpha_composite(logo, (int((W - logo.width) / 2), int(y))); y += logo.height + 60 * S
    for i, ((t, f, c), h) in enumerate(zip(rows, hs)):
        if t.startswith("Pandey Realty, Inc."): y += 40 * S
        d.text(((W - text_w(d, t, f)) / 2, y - f.getbbox(t)[1]), t, font=f, fill=c); y += h + 34 * S
    return im.convert("RGB")

def with_overlay(frame, ov, a):
    if a <= 0: return frame
    m = ov.getchannel("A").point(lambda v: int(v * a)) if a < 1 else ov.getchannel("A")
    frame.paste(ov.convert("RGB"), (0, 0), m); return frame

# ---------- render ----------
imgs = {n: Image.open(f"{LD}/photos/{n:02d}.jpg").convert("RGB") for n, _, _ in shots}
ovs = [title_overlay()] + [caption_overlay(c) for _, c, _ in shots[1:]]
endimg = end_card(imgs[shots[0][0]])
N = len(shots)
total = N * D + T + END
out = f"{LD}/{'tour-vertical' if VERT else 'tour'}.mp4"
ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                       "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], stdin=subprocess.PIPE)

def shot_frame(i, ts):
    n, _, m = shots[i]; t = min(max(ts / (D + T), 0), 1)
    fr = imgs[n].resize((W, H), Image.BICUBIC, box=rect(imgs[n], m, t))
    a = min(1, max(0, (ts - (0.3 if i else 0.5)) / 0.45)) * min(1, max(0, (D + 0.1 - ts) / 0.45))
    return with_overlay(fr, ovs[i], a)

poster = None
for f in range(int(total * FPS)):
    t = f / FPS
    if t >= N * D:  # end card, fading in over T
        k = min(1, (t - N * D) / T)
        e = endimg if k >= 1 else Image.blend(shot_frame(N - 1, t - (N - 1) * D), endimg, k)
    else:
        i = int(t // D); ts = t - i * D
        e = shot_frame(i, ts)
        if i > 0 and ts < T:  # still finishing the previous shot -> crossfade
            e = Image.blend(shot_frame(i - 1, ts + D), e, ts / T)
    if f == int(1.6 * FPS): poster = e.copy()
    ff.stdin.write(e.tobytes())
ff.stdin.close(); ff.wait()
if not VERT and poster: poster.save(f"{LD}/tour.jpg", quality=86)
# original background music (tools/music.py), a different key per listing, mixed to -16 LUFS
if "--silent" not in sys.argv:
    wav = out[:-4] + ".music.wav"; tmp = out[:-4] + ".tmp.mp4"
    import zlib; h = zlib.crc32(slug.encode()); key = h % 5 - 2
    subprocess.run([sys.executable, f"{ROOT}/tools/music.py", wav, "--seconds", f"{total:.2f}", "--key", str(key), "--seed", str(h % 1000)], check=True, stdout=subprocess.DEVNULL)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", out, "-i", wav, "-map", "0:v", "-map", "1:a", "-c:v", "copy",
                    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-shortest", "-movflags", "+faststart", tmp], check=True)
    os.replace(tmp, out); os.remove(wav)
print(out, f"{total:.1f}s", f"{os.path.getsize(out) / 1e6:.1f} MB", f"{N} shots")
