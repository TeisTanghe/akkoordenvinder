/* dsp.js — akkoordherkenning: FFT, chroma, toonsoort, Viterbi en een live-detector voor de microfoon. */
(typeof window !== 'undefined' ? window : self).DSP = (() => {
'use strict';

const SHARP = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const FLAT  = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
const SUFFIX = { maj: '', min: 'm', '7': '7', m7: 'm7', sus2: 'sus2', sus4: 'sus4', dim: 'dim', maj7: 'maj7' };
const MINORISH = { maj: false, min: true, '7': false, m7: true, sus2: false, sus4: false, dim: true, maj7: false };
const INTERVALS = { maj: [0,4,7], min: [0,3,7], '7': [0,4,7,10], m7: [0,3,7,10], sus2: [0,2,7], sus4: [0,5,7], dim: [0,3,6], maj7: [0,4,7,11] };
const QUALS = { basic: ['maj', 'min'], ext: ['maj', 'min', '7', 'm7'], full: ['maj', 'min', '7', 'm7', 'sus2', 'sus4', 'dim', 'maj7'] };
const DEG_MAJ = ['I','bII','II','bIII','III','IV','#IV','V','bVI','VI','bVII','VII'];
const DEG_MIN = ['I','bII','II','III','#III','IV','bV','V','VI','#VI','VII','#VII'];
const KS_MAJ = [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
const KS_MIN = [6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17];
const FMIN = 55, FMAX = 2000, BASS_MAX = 200;
const mod12 = n => ((n % 12) + 12) % 12;
const tick = () => new Promise(r => setTimeout(r, 0));

/* ---------- FFT (radix-2, in place) ---------- */
function makeFFT(n) {
  const levels = Math.log2(n), rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) { let r = 0, x = i; for (let j = 0; j < levels; j++) { r = (r << 1) | (x & 1); x >>= 1; } rev[i] = r; }
  const cs = new Float64Array(n / 2), sn = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cs[i] = Math.cos(2 * Math.PI * i / n); sn[i] = Math.sin(2 * Math.PI * i / n); }
  return (re, im) => {
    for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) for (let j = 0, k = 0; j < half; j++, k += step) {
        const a = i + j, b = a + half;
        const tr = re[b] * cs[k] + im[b] * sn[k], ti = im[b] * cs[k] - re[b] * sn[k];
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  };
}
const fftCache = new Map();
const getFFT = n => { if (!fftCache.has(n)) fftCache.set(n, makeFFT(n)); return fftCache.get(n); };
function hann(n) { const w = new Float64Array(n); for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)); return w; }

/* bin -> toonklasse-afbeelding voor een samplerate, FFT-grootte en stemmingsafwijking (in halve tonen) */
function binMap(sr, n, tuning) {
  const kMin = Math.floor(FMIN * n / sr), kMax = Math.min(n / 2 - 1, Math.ceil(FMAX * n / sr)), nb = kMax - kMin + 1;
  const pcOf = new Int8Array(nb), wOf = new Float32Array(nb), isBass = new Uint8Array(nb);
  for (let k = 0; k < nb; k++) {
    const freq = (k + kMin) * sr / n;
    const midi = 69 + 12 * Math.log2(freq / 440) - tuning, m = Math.round(midi), d = midi - m;
    pcOf[k] = mod12(m);
    wOf[k] = freq < FMIN ? 0 : Math.cos(Math.PI * d) ** 2;
    isBass[k] = freq <= BASS_MAX ? 1 : 0;
  }
  return { kMin, kMax, nb, pcOf, wOf, isBass };
}

/* ---------- beats: onset-envelope (FFT 1024, hop 256), tempo via autocorrelatie, fase via kamfilter ---------- */
function beatTrack(x, sr) {
  const n = 1024, hop = 256, fft = getFFT(n), win = hann(n);
  const nF = Math.max(1, Math.floor((x.length - n) / hop) + 1), nb = n / 2;
  const re = new Float64Array(n), im = new Float64Array(n), prev = new Float32Array(nb), onset = new Float32Array(nF);
  for (let f = 0; f < nF; f++) {
    const o = f * hop;
    for (let i = 0; i < n; i++) { re[i] = (o + i < x.length ? x[o + i] : 0) * win[i]; im[i] = 0; }
    fft(re, im);
    let s = 0;
    for (let k = 1; k < nb; k++) { const lg = Math.log1p(100 * Math.hypot(re[k], im[k])); const d = lg - prev[k]; if (d > 0) s += d; prev[k] = lg; }
    onset[f] = s;
  }
  // lokaal gemiddelde eraf (adaptieve drempel)
  const env = new Float32Array(nF);
  for (let f = 0; f < nF; f++) { let m = 0, c = 0; for (let d = -8; d <= 8; d++) { const g = f + d; if (g >= 0 && g < nF) { m += onset[g]; c++; } } env[f] = Math.max(0, onset[f] - m / c); }
  const fps = sr / hop, minLag = Math.round(fps * 60 / 180), maxLag = Math.round(fps * 60 / 60);
  let bestLag = 0, bestR = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let r = 0; for (let f = lag; f < nF; f++) r += env[f] * env[f - lag];
    const bpm = 60 * fps / lag, w = Math.exp(-0.5 * ((Math.log2(bpm / 115)) / 0.6) ** 2); // zachte voorkeur rond 115 bpm
    r *= w; if (r > bestR) { bestR = r; bestLag = lag; }
  }
  if (!bestLag) return { bpm: 0, beats: [], bars: [] };
  const rr = l => { let r = 0; for (let f = l; f < nF; f++) r += env[f] * env[f - l]; return r; };
  // octaaffout: achtste noten geven een dubbel tempo; als de dubbele lag bijna even sterk is en het tempo hoog, neem de helft
  const bpmOf = l => 60 * fps / l;
  if (bpmOf(bestLag) > 120 && 2 * bestLag <= nF / 4 && rr(2 * bestLag) >= 0.75 * rr(bestLag)) bestLag *= 2;
  else if (bpmOf(bestLag) < 62 && rr(Math.round(bestLag / 2)) >= 0.9 * rr(bestLag)) bestLag = Math.round(bestLag / 2);
  // verfijning met parabolische interpolatie van de lag
  const a = rr(bestLag - 1), b = rr(bestLag), c = rr(bestLag + 1), den = a - 2 * b + c;
  const period = bestLag + (den !== 0 ? 0.5 * (a - c) / den : 0);
  let bestOff = 0, bestS = -1;
  for (let off = 0; off < period; off += 0.5) { let s = 0; for (let t = off; t < nF; t += period) s += env[Math.round(t)] || 0; if (s > bestS) { bestS = s; bestOff = off; } }
  const beats = []; for (let t = bestOff; t < nF; t += period) beats.push((t * hop + n / 2) / sr);
  // maatstart (4/4): fase met de meeste onset-energie
  let bestPh = 0, bestPS = -1;
  for (let ph = 0; ph < 4; ph++) { let s = 0; for (let i = ph; i < beats.length; i += 4) { const f = Math.round((beats[i] * sr - n / 2) / hop); s += env[f] || 0; } if (s > bestPS) { bestPS = s; bestPh = ph; } }
  const bars = beats.filter((_, i) => i % 4 === bestPh);
  return { bpm: Math.round(60 * fps / period * 10) / 10, beats, bars };
}

/* ---------- kenmerken van een heel bestand ---------- */
async function extractFeatures(x, sr, opts = {}) {
  const n = opts.n || 8192, hop = opts.hop || 2048, progress = opts.progress || (() => {});
  const fft = getFFT(n), win = hann(n);
  const nF = Math.max(1, Math.floor((x.length - n) / hop) + 1);
  const { kMin, nb } = binMap(sr, n, 0);
  const spec = new Float32Array(nF * nb), rms = new Float32Array(nF);
  const re = new Float64Array(n), im = new Float64Array(n);

  for (let f = 0; f < nF; f++) {
    const o = f * hop; let e = 0;
    for (let i = 0; i < n; i++) { const s = o + i < x.length ? x[o + i] : 0; re[i] = s * win[i]; im[i] = 0; e += s * s; }
    rms[f] = Math.sqrt(e / n);
    fft(re, im);
    for (let k = 0; k < nb; k++) { const kk = k + kMin; spec[f * nb + k] = Math.hypot(re[kk], im[kk]); }
    if (f % 48 === 0) { progress(0.1 + 0.8 * f / nF); await tick(); }
  }

  // stemming: circulair gemiddelde van de afwijking van pieken t.o.v. gelijkzwevende stemming
  let cr = 0, ci = 0;
  for (let f = 0; f < nF; f += 2) {
    const base = f * nb; let m = 0;
    for (let k = 0; k < nb; k++) if (spec[base + k] > m) m = spec[base + k];
    if (m <= 0) continue;
    for (let k = 1; k < nb - 1; k++) {
      const v = spec[base + k], a = spec[base + k - 1], c = spec[base + k + 1];
      if (v > m * 0.1 && v > a && v >= c) {
        const la = Math.log(a + 1e-9), lb = Math.log(v + 1e-9), lc = Math.log(c + 1e-9);
        const den = la - 2 * lb + lc, p = den !== 0 ? 0.5 * (la - lc) / den : 0;
        const midi = 69 + 12 * Math.log2(((k + kMin + p) * sr / n) / 440), d = midi - Math.round(midi);
        cr += v * Math.cos(2 * Math.PI * d); ci += v * Math.sin(2 * Math.PI * d);
      }
    }
  }
  const tuning = (cr || ci) ? Math.atan2(ci, cr) / (2 * Math.PI) : 0;
  const map = binMap(sr, n, tuning);

  const maxima = new Float32Array(nF);
  for (let f = 0; f < nF; f++) { let m = 0; for (let k = 0; k < nb; k++) if (spec[f * nb + k] > m) m = spec[f * nb + k]; maxima[f] = m; }
  const sorted = Array.from(maxima).filter(v => v > 0).sort((a, b) => a - b);
  const ref = sorted.length ? sorted[Math.floor(sorted.length * 0.5)] : 1;

  // zangactiviteit: spectrale flux en energie-aandeel in het zangbereik (300-2000 Hz), gladgestreken en genormaliseerd
  const kLo = Math.max(0, Math.floor(300 * n / sr) - kMin), kHi = Math.min(nb - 1, Math.ceil(2000 * n / sr) - kMin);
  const rawV = new Float32Array(nF); let prevLg = new Float32Array(kHi - kLo + 1), curLg = new Float32Array(kHi - kLo + 1);
  for (let f = 0; f < nF; f++) {
    let fl = 0, mid = 0, tot = 0;
    for (let k = 0; k < nb; k++) { const v = spec[f * nb + k]; tot += v * v; }
    for (let k = kLo; k <= kHi; k++) { const v = spec[f * nb + k]; mid += v * v; curLg[k - kLo] = Math.log1p(50 * v / ref); const d = curLg[k - kLo] - prevLg[k - kLo]; if (d > 0) fl += d; }
    [prevLg, curLg] = [curLg, prevLg];
    rawV[f] = fl * Math.sqrt(tot > 0 ? mid / tot : 0);
  }
  const vocal = new Float32Array(nF);
  for (let f = 0; f < nF; f++) { let s = 0, c = 0; for (let d = -3; d <= 3; d++) { const g = f + d; if (g >= 0 && g < nF) { s += rawV[g]; c++; } } vocal[f] = s / c; }
  const vs = Array.from(vocal).sort((a, b) => a - b), lo = vs[Math.floor(vs.length * 0.2)] || 0, hi = vs[Math.floor(vs.length * 0.9)] || 1;
  for (let f = 0; f < nF; f++) vocal[f] = Math.max(0, Math.min(1, (vocal[f] - lo) / ((hi - lo) || 1)));
  const vocalOnsets = []; let vocalStart = -1, vocalEnd = -1, run = 0;
  for (let f = 0; f < nF; f++) {
    const on = vocal[f] > 0.5;
    if (on && (f === 0 || vocal[f - 1] <= 0.5)) vocalOnsets.push(f);
    run = on ? run + 1 : 0;
    if (run >= 4 && vocalStart < 0) vocalStart = f - 3;
    if (on) vocalEnd = f;
  }

  const rawC = new Float32Array(nF * 12), rawB = new Float32Array(nF * 12);
  for (let f = 0; f < nF; f++) for (let k = 0; k < nb; k++) {
    const w = map.wOf[k]; if (!w) continue;
    const c = w * Math.log1p(50 * spec[f * nb + k] / ref);
    rawC[f * 12 + map.pcOf[k]] += c;
    if (map.isBass[k]) rawB[f * 12 + map.pcOf[k]] += c;
  }

  // temporele mediaan (5 frames) per toonklasse: dempt drums en transiënten (goedkope HPSS-benadering)
  const medC = new Float32Array(nF * 12), tmp = new Float32Array(5);
  for (let p = 0; p < 12; p++) for (let f = 0; f < nF; f++) {
    let c = 0; for (let d = -2; d <= 2; d++) { const g = Math.min(nF - 1, Math.max(0, f + d)); tmp[c++] = rawC[g * 12 + p]; }
    const s = Array.from(tmp).sort((a, b) => a - b); medC[f * 12 + p] = s[2];
  }
  rawC.set(medC);
  const chroma = new Float32Array(nF * 12), bass = new Float32Array(nF * 12), silent = new Uint8Array(nF);
  const rmsSorted = Array.from(rms).sort((a, b) => a - b);
  const rmsRef = rmsSorted[Math.floor(rmsSorted.length * 0.95)] || 1;
  const keySum = new Float64Array(12);
  for (let f = 0; f < nF; f++) {
    const v = new Float64Array(12), b = new Float64Array(12);
    for (let df = -1; df <= 1; df++) {
      const g = Math.min(nF - 1, Math.max(0, f + df)), w = df === 0 ? 1 : 0.5;
      for (let p = 0; p < 12; p++) { v[p] += w * rawC[g * 12 + p]; b[p] += w * rawB[g * 12 + p]; }
    }
    let sum = 0; for (let p = 0; p < 12; p++) sum += v[p];
    silent[f] = (rms[f] < 0.02 * rmsRef || sum < 1e-6) ? 1 : 0;
    const mean = sum / 12; let nrm = 0;
    for (let p = 0; p < 12; p++) { v[p] -= mean; nrm += v[p] * v[p]; }
    nrm = Math.sqrt(nrm) || 1;
    let bm = 0; for (let p = 0; p < 12; p++) if (b[p] > bm) bm = b[p];
    for (let p = 0; p < 12; p++) {
      chroma[f * 12 + p] = v[p] / nrm;
      bass[f * 12 + p] = bm > 0 ? b[p] / bm : 0;
      if (!silent[f]) keySum[p] += rawC[f * 12 + p];
    }
  }
  progress(0.93); await tick();
  const bt = beatTrack(x, sr);
  progress(0.97);
  return { nF, n, hop, sr, chroma, bass, silent, tuning, key: estimateKey(keySum), vocal, vocalOnsets, vocalStart, vocalEnd, bpm: bt.bpm, beats: bt.beats, bars: bt.bars };
}

/* ---------- toonsoort (Krumhansl-Schmuckler) ---------- */
function pearson(a, b) {
  const n = a.length; let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return da && db ? num / Math.sqrt(da * db) : 0;
}
function estimateKey(sum) {
  let best = { root: 0, mode: 'maj', r: -2 };
  for (let t = 0; t < 12; t++) {
    const rot = Array.from({ length: 12 }, (_, i) => sum[(i + t) % 12]);
    const rM = pearson(rot, KS_MAJ), rm = pearson(rot, KS_MIN);
    if (rM > best.r) best = { root: t, mode: 'maj', r: rM };
    if (rm > best.r) best = { root: t, mode: 'min', r: rm };
  }
  return best;
}

/* ---------- akkoordsjablonen ---------- */
function makeTemplate(root, q) {
  const t = new Float64Array(12);
  INTERVALS[q].forEach((iv, i) => {
    const n = (root + iv) % 12, w = i === 3 ? 0.8 : 1;
    t[n] += w; t[(n + 7) % 12] += 0.3 * w; t[(n + 4) % 12] += 0.1 * w;
  });
  const mean = t.reduce((a, b) => a + b, 0) / 12; let nrm = 0;
  for (let p = 0; p < 12; p++) { t[p] -= mean; nrm += t[p] * t[p]; }
  nrm = Math.sqrt(nrm);
  for (let p = 0; p < 12; p++) t[p] /= nrm;
  return t;
}
function chordSet(detail) {
  const quals = QUALS[detail] || QUALS.basic;
  const out = [];
  for (const q of quals) for (let r = 0; r < 12; r++) out.push({ root: r, q, t: makeTemplate(r, q) });
  return out;
}
function isDiatonic(ch, key) {
  const d = mod12(ch.root - key.root), minor = MINORISH[ch.q];
  if (key.mode === 'maj') return minor ? [2, 4, 9].includes(d) : [0, 5, 7].includes(d);
  return minor ? [0, 5, 7].includes(d) : [3, 7, 8, 10].includes(d);
}

/* ---------- Viterbi over een heel bestand ---------- */
function recognise(F, { detail = 'basic', stability = 1.6, duration }) {
  const chords = chordSet(detail);
  const S = chords.length + 1, NC = chords.length, nF = F.nF;
  const back = new Int16Array(nF * S), raw = new Float32Array(nF * S);
  let D = new Float64Array(S), ND = new Float64Array(S);
  const extra = q => q === '7' || q === 'm7' ? 0.05 : (q === 'sus2' || q === 'sus4' || q === 'dim' || q === 'maj7') ? 0.09 : 0;
  const prior = chords.map(c => (isDiatonic(c, F.key) ? 0.04 : 0) - extra(c.q));
  // wisselstraf per frame: lager op een beat, nog lager op een maatstart
  const frameTime = f => (f * F.hop + F.n / 2) / F.sr, half = F.hop / F.sr / 2;
  const near = (arr, t) => { if (!arr || !arr.length) return false; let lo = 0, hi = arr.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < t) lo = m + 1; else hi = m; } return Math.abs(arr[lo] - t) <= half || (lo > 0 && Math.abs(arr[lo - 1] - t) <= half); };
  const pen = new Float64Array(nF);
  for (let f = 0; f < nF; f++) { const t = frameTime(f); pen[f] = stability * (near(F.bars, t) ? 0.4 : near(F.beats, t) ? 0.6 : 1); }

  for (let f = 0; f < nF; f++) {
    const em = new Float64Array(S), o = f * 12;
    for (let s = 0; s < NC; s++) {
      const t = chords[s].t; let c = 0;
      for (let p = 0; p < 12; p++) c += F.chroma[o + p] * t[p];
      raw[f * S + s] = c;
      em[s] = F.silent[f] ? -1 : c + 0.08 * F.bass[o + chords[s].root] + prior[s];
    }
    em[NC] = F.silent[f] ? 1.5 : 0.2;
    if (f === 0) { for (let s = 0; s < S; s++) { D[s] = em[s]; back[s] = s; } continue; }
    let b = 0; for (let s = 1; s < S; s++) if (D[s] > D[b]) b = s;
    const P = pen[f];
    for (let s = 0; s < S; s++) {
      const stay = D[s], sw = D[b] - P;
      if (s === b || stay >= sw) { ND[s] = stay + em[s]; back[f * S + s] = s; }
      else { ND[s] = sw + em[s]; back[f * S + s] = b; }
    }
    [D, ND] = [ND, D];
  }
  const path = new Int16Array(nF);
  let s = 0; for (let i = 1; i < S; i++) if (D[i] > D[s]) s = i;
  for (let f = nF - 1; f >= 0; f--) { path[f] = s; s = back[f * S + s]; }

  // segmenten korter dan één beat samenvoegen met de buur waarvan het akkoord het best past
  const beatFrames = F.bpm ? Math.max(1, Math.round(60 / F.bpm * F.sr / F.hop)) : 1;
  const score = (f0, f1, st) => { if (st === NC) return -1; let s = 0; for (let f = f0; f <= f1; f++) s += raw[f * S + st]; return s / (f1 - f0 + 1); };
  let changed = true;
  while (changed) {
    changed = false;
    let f = 0;
    while (f < nF) {
      let g = f; while (g + 1 < nF && path[g + 1] === path[f]) g++;
      const len = g - f + 1;
      if (len < beatFrames && (f > 0 || g < nF - 1)) {
        const prevSt = f > 0 ? path[f - 1] : -1, nextSt = g < nF - 1 ? path[g + 1] : -1;
        const sp = prevSt >= 0 ? score(f, g, prevSt) : -Infinity, sn = nextSt >= 0 ? score(f, g, nextSt) : -Infinity;
        const to = sp >= sn ? prevSt : nextSt;
        if (to >= 0 && to !== path[f]) { for (let k = f; k <= g; k++) path[k] = to; changed = true; }
      }
      f = g + 1;
    }
  }

  const bound = f => f === 0 ? 0 : Math.min(duration, (f * F.hop + F.n / 2 - F.hop / 2) / F.sr);
  const segs = [];
  for (let f = 0; f < nF; f++) {
    const st = path[f], last = segs[segs.length - 1];
    if (last && last.state === st) { last.f1 = f; last.sum += raw[f * S + st]; last.n++; }
    else segs.push({ state: st, f0: f, f1: f, sum: st === NC ? 0 : raw[f * S + st], n: 1 });
  }
  // basnoot: als één akkoordtoon (niet de grondtoon) het grootste deel van het segment in de bas domineert -> C/E
  const bassOf = g => {
    const ch = chords[g.state], tones = INTERVALS[ch.q].map(iv => mod12(ch.root + iv)), cnt = new Int32Array(12);
    for (let f = g.f0; f <= g.f1; f++) { let b = 0; for (let p = 1; p < 12; p++) if (F.bass[f * 12 + p] > F.bass[f * 12 + b]) b = p; if (F.bass[f * 12 + b] > 0.5) cnt[b]++; }
    let best = -1; for (let p = 0; p < 12; p++) if (best < 0 || cnt[p] > cnt[best]) best = p;
    return best >= 0 && best !== ch.root && tones.includes(best) && cnt[best] >= 0.7 * (g.f1 - g.f0 + 1) ? best : null;
  };
  return segs.map((g, i) => ({
    start: bound(g.f0),
    end: i === segs.length - 1 ? duration : bound(g.f1 + 1),
    chord: g.state === NC ? null : { root: chords[g.state].root, q: chords[g.state].q, bass: bassOf(g) },
    conf: g.state === NC ? 1 : g.sum / g.n
  })).filter(g => g.end > g.start);
}

/* ---------- live-detector (microfoon / tabblad-audio) ----------
   Voer samples aan op `sr` (bij voorkeur ~11-12 kHz); hij roept onChord({chord, conf, time}) en onKey(key) aan. */
class LiveDetector {
  constructor({ sr, n = 4096, hop = 1024, detail = 'basic', onChord, onKey }) {
    this.sr = sr; this.n = n; this.hop = hop;
    this.onChord = onChord || (() => {}); this.onKey = onKey || (() => {});
    this.fft = getFFT(n); this.win = hann(n);
    this.map = binMap(sr, n, 0);
    this.re = new Float64Array(n); this.im = new Float64Array(n);
    this.buf = new Float32Array(0); this.pos = 0; this.samples = 0;
    this.smooth = new Float64Array(12); this.keySum = new Float64Array(12);
    this.ref = 0; this.rmsRef = 0; this.current = null; this.candidate = null; this.candCount = 0;
    this.frames = 0; this.lastKeyFrame = 0; this.key = null;
    this.setDetail(detail);
  }
  setDetail(detail) { this.chords = chordSet(detail); }
  reset() { this.smooth.fill(0); this.keySum.fill(0); this.current = null; this.candidate = null; this.candCount = 0; this.key = null; }
  push(chunk) {
    const merged = new Float32Array(this.buf.length + chunk.length);
    merged.set(this.buf); merged.set(chunk, this.buf.length);
    this.buf = merged;
    while (this.buf.length >= this.n) {
      this.frame(this.buf.subarray(0, this.n));
      this.buf = this.buf.slice(this.hop);
      this.samples += this.hop;
    }
  }
  frame(x) {
    const { n, re, im, win, map } = this; let e = 0;
    for (let i = 0; i < n; i++) { re[i] = x[i] * win[i]; im[i] = 0; e += x[i] * x[i]; }
    const rms = Math.sqrt(e / n);
    this.rmsRef = Math.max(rms, this.rmsRef * 0.995);
    this.fft(re, im);
    const nb = map.nb, mag = new Float32Array(nb); let m = 0;
    for (let k = 0; k < nb; k++) { const kk = k + map.kMin; mag[k] = Math.hypot(re[kk], im[kk]); if (mag[k] > m) m = mag[k]; }
    this.ref = Math.max(m, this.ref * 0.98) || 1;
    const raw = new Float64Array(12), bass = new Float64Array(12);
    for (let k = 0; k < nb; k++) {
      const w = map.wOf[k]; if (!w) continue;
      const c = w * Math.log1p(50 * mag[k] / this.ref);
      raw[map.pcOf[k]] += c; if (map.isBass[k]) bass[map.pcOf[k]] += c;
    }
    const silent = rms < 0.03 * this.rmsRef || m <= 0;
    this.frames++;
    const time = this.samples / this.sr;
    if (silent) {
      this.candCount = 0;
      if (this.current !== null && ++this.silentFrames > 8) { this.current = null; this.onChord({ chord: null, conf: 1, time }); }
      return;
    }
    this.silentFrames = 0;
    let sum = 0; for (let p = 0; p < 12; p++) sum += raw[p];
    const mean = sum / 12; let nrm = 0;
    for (let p = 0; p < 12; p++) { raw[p] -= mean; nrm += raw[p] * raw[p]; }
    nrm = Math.sqrt(nrm) || 1;
    let bm = 0; for (let p = 0; p < 12; p++) if (bass[p] > bm) bm = bass[p];
    for (let p = 0; p < 12; p++) { this.smooth[p] = 0.65 * this.smooth[p] + 0.35 * raw[p] / nrm; this.keySum[p] += raw[p] + mean; }
    // beste sjabloon op de gladgestreken chroma
    let best = -1, bestS = -Infinity, curS = -Infinity;
    for (let s = 0; s < this.chords.length; s++) {
      const t = this.chords[s].t; let c = 0;
      for (let p = 0; p < 12; p++) c += this.smooth[p] * t[p];
      c += 0.08 * (bm > 0 ? bass[this.chords[s].root] / bm : 0);
      if (this.key && isDiatonic(this.chords[s], this.key)) c += 0.04;
      if (c > bestS) { bestS = c; best = s; }
      if (this.current && this.chords[s].root === this.current.root && this.chords[s].q === this.current.q) curS = c;
    }
    const b = this.chords[best];
    const same = this.current && b.root === this.current.root && b.q === this.current.q;
    if (same) { this.candCount = 0; return; }
    if (this.candidate && this.candidate.root === b.root && this.candidate.q === b.q) this.candCount++;
    else { this.candidate = { root: b.root, q: b.q }; this.candCount = 1; }
    const margin = this.current ? 0.12 : 0.0;
    if (this.candCount >= 3 && bestS > curS + margin) {
      this.current = { root: b.root, q: b.q };
      this.candCount = 0;
      this.onChord({ chord: this.current, conf: bestS, time });
    }
    if (this.frames - this.lastKeyFrame >= 24) {
      this.lastKeyFrame = this.frames;
      const k = estimateKey(this.keySum);
      if (!this.key || k.root !== this.key.root || k.mode !== this.key.mode) { this.key = k; this.onKey(k); }
    }
  }
}

/* ---------- namen en kleuren ---------- */
function prefersFlats(root, mode) {
  return mode === 'maj' ? [5, 10, 3, 8, 1].includes(root) : [2, 7, 0, 5, 10, 3].includes(root);
}
function chordName(ch, { shift = 0, flats = false } = {}) {
  if (!ch) return 'N.C.';
  const names = flats ? FLAT : SHARP;
  return names[mod12(ch.root + shift)] + SUFFIX[ch.q] + (ch.bass != null ? '/' + names[mod12(ch.bass + shift)] : '');
}
function roman(ch, key) {
  if (!ch || !key) return '';
  const d = mod12(ch.root - key.root);
  let r = (key.mode === 'maj' ? DEG_MAJ : DEG_MIN)[d];
  if (MINORISH[ch.q]) r = r.toLowerCase();
  return r + (ch.q === '7' || ch.q === 'm7' ? '7' : ch.q === 'maj7' ? 'maj7' : ch.q === 'dim' ? '°' : ch.q === 'sus2' || ch.q === 'sus4' ? ch.q : '');
}
const hueOf = ch => ch ? (mod12(ch.root * 7) * 30 + 215) % 360 : 0;
function keyName(key, shift = 0) {
  if (!key) return '–';
  const r = mod12(key.root + shift);
  return (prefersFlats(r, key.mode) ? FLAT : SHARP)[r] + (key.mode === 'maj' ? ' majeur' : ' mineur');
}

return { SHARP, FLAT, SUFFIX, MINORISH, INTERVALS, QUALS, mod12, extractFeatures, recognise, estimateKey, LiveDetector, beatTrack,
         prefersFlats, chordName, roman, hueOf, keyName, tick };
})();
