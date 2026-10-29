#!/usr/bin/env python3
"""Original, copyright-free background music for listing tours (synthesized from scratch, no samples).

  python3 tools/music.py <out.wav> [--seconds 59.7] [--key 0] [--bpm 96]

Luxury / upbeat chill-house feel: warm pad, bell-piano arpeggio, sub bass, soft drums,
a riser into the drop at bar 5, and a calm ending that rings out on the last chord.
--key shifts everything in semitones so each listing can get its own variation.
"""
import argparse, numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
from scipy.io import wavfile

ap = argparse.ArgumentParser(); ap.add_argument("out"); ap.add_argument("--seconds", type=float, default=59.7)
ap.add_argument("--key", type=int, default=0); ap.add_argument("--bpm", type=float, default=96); ap.add_argument("--seed", type=int, default=7)
A = ap.parse_args()
SR = 44100; DUR = A.seconds; N = int(SR * DUR); rng = np.random.default_rng(A.seed)
BEAT = 60 / A.bpm; BAR = 4 * BEAT
L = np.zeros(N); R = np.zeros(N); VERB = np.zeros(N)
hz = lambda m: 440 * 2 ** ((m + A.key - 69) / 12)

def lp(x, f): return sosfilt(butter(2, f, "low", fs=SR, output="sos"), x)
def hp(x, f): return sosfilt(butter(2, f, "high", fs=SR, output="sos"), x)
def bp(x, lo, hi): return sosfilt(butter(2, [lo, hi], "band", fs=SR, output="sos"), x)

def add(sig, t0, gain=1.0, pan=0.0, verb=0.0):
    i = int(t0 * SR)
    if i >= N: return
    sig = sig[: N - i] * gain
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    L[i:i + len(sig)] += sig * l * 1.414; R[i:i + len(sig)] += sig * r * 1.414; VERB[i:i + len(sig)] += sig * verb

def env(n, a, d=None, rel=0.05):
    t = np.arange(n) / SR; e = np.minimum(1, t / max(a, 1e-4))
    if d: e *= np.exp(-t / d)
    k = int(rel * SR); e[-k:] *= np.linspace(1, 0, k) if k < n else 1
    return e

# progression: Am9, Fmaj9, Cmaj9, G6/9  (bass, chord tones)
PROG = [(45, [60, 64, 67, 71]), (41, [57, 60, 64, 67]), (48, [64, 67, 71, 74]), (43, [59, 62, 64, 69])]
BARS = int(np.ceil(DUR / BAR)) + 1

def pad(notes, dur):
    n = int(dur * SR); t = np.arange(n) / SR; s = np.zeros(n)
    for m in notes:
        for det in (-0.07, 0.0, 0.07):
            f = hz(m) * 2 ** (det / 12)
            ph = rng.random()
            s += 2 * ((t * f + ph) % 1) - 1          # saw
    s = lp(s / (len(notes) * 3), 1400)
    return s * env(n, 0.6, rel=0.6)

def bell(m, dur=1.2):
    n = int(dur * SR); t = np.arange(n) / SR; f = hz(m)
    s = (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t / 0.25)
         + 0.12 * np.sin(2 * np.pi * 3.01 * f * t) * np.exp(-t / 0.12))
    return s * env(n, 0.004, d=0.45, rel=0.1)

def sub(m, dur):
    n = int(dur * SR); t = np.arange(n) / SR
    s = np.sin(2 * np.pi * hz(m - 12) * t) + 0.2 * np.sin(2 * np.pi * hz(m) * t)
    return s * env(n, 0.03, rel=0.15)

def kick():
    n = int(0.45 * SR); t = np.arange(n) / SR
    f = 48 + 90 * np.exp(-t / 0.035); ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t / 0.16)

def clap():
    n = int(0.3 * SR); t = np.arange(n) / SR
    s = bp(rng.standard_normal(n), 900, 4000)
    e = np.exp(-t / 0.07) * (1 + 0.6 * ((t % 0.011) < 0.004) * (t < 0.03))
    return s * e

def hat(open_=False):
    n = int((0.22 if open_ else 0.06) * SR); t = np.arange(n) / SR
    return hp(rng.standard_normal(n), 7000) * np.exp(-t / (0.08 if open_ else 0.018))

def riser(dur):
    n = int(dur * SR); t = np.arange(n) / SR
    noise = rng.standard_normal(n); out = np.zeros(n); seg = int(0.05 * SR)
    for i in range(0, n, seg):
        fc = 300 + 7000 * (i / n) ** 2
        out[i:i + seg] = bp(noise[max(0, i - 2000):i + seg], fc * 0.7, min(fc * 1.4, 18000))[-len(out[i:i + seg]):]
    return out * (t / dur) ** 2

def impact():
    n = int(2.5 * SR); t = np.arange(n) / SR
    boom = np.sin(2 * np.pi * (40 + 30 * np.exp(-t / 0.1)) * t) * np.exp(-t / 0.6)
    crash = hp(rng.standard_normal(n), 5000) * np.exp(-t / 0.9) * 0.35
    return boom + crash

last_bar = int(DUR // BAR)               # bar index where the ending chord lands
drums_from, drums_to = 4, max(5, last_bar - 3)
for b in range(BARS):
    t0 = b * BAR
    if t0 >= DUR: break
    bass, ch = PROG[b % 4]
    final = b >= last_bar - 1
    if final: bass, ch = PROG[0]
    dur = (DUR - t0) if final else BAR + 0.6
    add(pad(ch, dur), t0, 0.32, verb=0.35)
    if final:
        for k, m in enumerate(ch + [ch[0] + 12]):
            add(bell(m + 12, 3.5), t0 + k * 0.09, 0.22, pan=-0.4 + 0.2 * k, verb=0.6)
        add(sub(bass, min(dur, BAR * 1.5)), t0, 0.35)
        break
    # bell arpeggio from bar 1
    if b >= 1:
        pat = [0, 2, 1, 3, 2, 1, 3, 2]
        for k in range(8):
            m = ch[pat[k]] + 12
            add(bell(m), t0 + k * BEAT / 2, 0.16 if k % 2 == 0 else 0.11, pan=(-0.35 if k % 2 else 0.35), verb=0.45)
    if b >= drums_from:
        add(sub(bass, BAR), t0, 0.42)
    if drums_from <= b < drums_to:
        for q in range(4):
            tb = t0 + q * BEAT
            if q in (0, 2): add(kick(), tb, 0.85)
            if q == 2 and b % 2: add(kick(), tb + BEAT * 1.5, 0.55)
            if q in (1, 3): add(clap(), tb, 0.32, verb=0.3)
            add(hat(), tb + BEAT / 2, 0.16, pan=0.25)
            add(hat(), tb, 0.07, pan=-0.2)
        if b % 4 == 3: add(hat(True), t0 + 3.5 * BEAT, 0.12, pan=0.3)
# riser into the drop + impact
add(riser(BAR * 1.0), drums_from * BAR - BAR, 0.18, verb=0.2)
add(impact(), drums_from * BAR, 0.45, verb=0.4)
# gentle intro shimmer
add(hp(rng.standard_normal(int(BAR * 2 * SR)), 9000) * np.linspace(0, 1, int(BAR * 2 * SR)) ** 2 * 0.03, 0)

# reverb: exponentially decaying stereo noise impulse response
irn = int(2.2 * SR); ti = np.arange(irn) / SR
ir_l = rng.standard_normal(irn) * np.exp(-ti / 0.55); ir_r = rng.standard_normal(irn) * np.exp(-ti / 0.55)
ir_l = lp(ir_l, 6000); ir_r = lp(ir_r, 6000)
wl = fftconvolve(VERB, ir_l)[:N]; wr = fftconvolve(VERB, ir_r)[:N]
L += wl / np.max(np.abs(ir_l)) * 0.035; R += wr / np.max(np.abs(ir_r)) * 0.035

mix = np.stack([L, R], 1)
mix = np.tanh(mix * 1.3) / np.tanh(1.3)                  # soft glue / limiter
fade_in, fade_out = int(0.05 * SR), int(2.0 * SR)
mix[:fade_in] *= np.linspace(0, 1, fade_in)[:, None]; mix[-fade_out:] *= np.linspace(1, 0, fade_out)[:, None] ** 1.5
mix = mix / np.max(np.abs(mix)) * 0.89
wavfile.write(A.out, SR, (mix * 32767).astype(np.int16))
print(A.out, f"{DUR:.1f}s")
