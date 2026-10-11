/* instruments.js — grepen en toetsen per instrument, los van de herkenning. */
window.Instruments = (() => {
'use strict';
const { INTERVALS, mod12, SHARP, FLAT } = window.DSP;

const LIST = [
  { id: 'piano', name: 'Piano' },
  { id: 'guitar', name: 'Gitaar' },
  { id: 'ukulele', name: 'Ukelele' },
  { id: 'bass', name: 'Bas' }
];
const TUNING = {
  guitar: [40, 45, 50, 55, 59, 64],   // E2 A2 D3 G3 B3 E4
  ukulele: [67, 60, 64, 69],          // G4 C4 E4 A4 (reentrant)
  bass: [28, 33, 38, 43]              // E1 A1 D2 G2
};
const STRING_NAMES = { guitar: 'E A D G B E', ukulele: 'G C E A', bass: 'E A D G' };

/* ---------- gitaar: open grepen + E-/A-vorm barré ---------- */
const OPEN = {
  '0:maj': [-1,3,2,0,1,0], '2:maj': [-1,-1,0,2,3,2], '4:maj': [0,2,2,1,0,0], '7:maj': [3,2,0,0,0,3], '9:maj': [-1,0,2,2,2,0],
  '9:min': [-1,0,2,2,1,0], '2:min': [-1,-1,0,2,3,1], '4:min': [0,2,2,0,0,0],
  '0:7': [-1,3,2,3,1,0], '2:7': [-1,-1,0,2,1,2], '4:7': [0,2,0,1,0,0], '7:7': [3,2,0,0,0,1], '9:7': [-1,0,2,0,2,0], '11:7': [-1,2,1,2,0,2],
  '9:m7': [-1,0,2,0,1,0], '4:m7': [0,2,0,0,0,0], '2:m7': [-1,-1,0,2,1,1]
};
const E_SHAPE = { maj: [0,2,2,1,0,0], min: [0,2,2,0,0,0], '7': [0,2,0,1,0,0], m7: [0,2,0,0,0,0] };
const A_SHAPE = { maj: [-1,0,2,2,2,0], min: [-1,0,2,2,1,0], '7': [-1,0,2,0,2,0], m7: [-1,0,2,0,1,0] };
function guitarShape(root, q) {
  const open = OPEN[root + ':' + q];
  if (open) return { frets: open, barre: 0 };
  if (E_SHAPE[q]) {
    const rE = mod12(root - 4) || 12, rA = mod12(root - 9) || 12;
    const useE = rE <= rA, r = useE ? rE : rA, base = useE ? E_SHAPE[q] : A_SHAPE[q];
    return { frets: base.map(f => f < 0 ? -1 : f + r), barre: r };
  }
  return searchShape(TUNING.guitar, root, q, { maxFret: 7, mute: 2 }); // sus, dim, maj7: beste greep zoeken
}

/* ---------- beste greep zoeken (ukelele altijd, gitaar voor bijzondere akkoorden) ---------- */
const shapeCache = new Map();
function searchShape(tuning, root, q, { maxFret = 12, mute = 0 } = {}) {
  const key = tuning.join(',') + ':' + root + ':' + q;
  if (shapeCache.has(key)) return shapeCache.get(key);
  const tones = INTERVALS[q].map(iv => mod12(root + iv)), nS = tuning.length;
  const options = tuning.map((open, s) => {
    const o = [];
    for (let f = 0; f <= maxFret; f++) if (tones.includes(mod12(open + f))) o.push(f);
    if (s < mute) o.push(-1);
    return o;
  });
  let best = null;
  const walk = (i, frets) => {
    if (i === nS) {
      const played = frets.filter(f => f >= 0); if (played.length < Math.min(3, nS)) return;
      const pcs = new Set(frets.map((f, s) => f < 0 ? -1 : mod12(tuning[s] + f)));
      if (!pcs.has(tones[0]) || !pcs.has(tones[1]) || !pcs.has(tones[2])) return;
      const fretted = frets.filter(f => f > 0), maxF = Math.max(0, ...fretted), minF = fretted.length ? Math.min(...fretted) : 0;
      const span = fretted.length ? maxF - minF : 0;
      if (span > 4 || fretted.length > 4 + (frets.filter(f => f === minF).length > 1 ? 2 : 0)) return;
      let score = maxF * 2 + span * 1.5 + fretted.length * 0.6 + frets.filter(f => f < 0).length * 1.2;
      if (tones.length === 4 && !pcs.has(tones[3])) score += 3;
      const low = frets.findIndex(f => f >= 0);
      if (low >= 0 && mod12(tuning[low] + frets[low]) === tones[0]) score -= 1;
      if (!best || score < best.score) best = { frets: frets.slice(), score };
      return;
    }
    for (const f of options[i]) { frets.push(f); walk(i + 1, frets); frets.pop(); }
  };
  walk(0, []);
  const frets = best ? best.frets : tuning.map(() => 0);
  const fretted = frets.filter(f => f > 0), minF = fretted.length ? Math.min(...fretted) : 0;
  const barre = (minF > 0 && !frets.includes(0) && frets.filter(f => f === minF).length >= 2) ? minF : 0;
  const res = { frets, barre };
  shapeCache.set(key, res);
  return res;
}
const ukuleleShape = (root, q) => searchShape(TUNING.ukulele, root, q);

/* ---------- bas: grondtoon, terts, kwint, octaaf ---------- */
function bassShape(root, q) {
  let s = 0, f = mod12(root - 4);
  if (f > 7) { s = 1; f = mod12(root - 9); }
  const third = INTERVALS[q][1] === 5 || INTERVALS[q][1] === 2 ? 4 : INTERVALS[q][1];
  const dots = [{ s, f, l: 'R' }, { s: s + 1, f: f + 2, l: '5' }, { s: s + 2, f: f + 2, l: '8' }];
  const tf = f + third - 5;
  if (tf >= 0) dots.push({ s: s + 1, f: tf, l: '3' }); else dots.push({ s, f: f + third, l: '3' });
  return { dots, strings: 4 };
}

/* ---------- SVG: fretdiagram (gitaar, ukelele, bas) ---------- */
function fretDiagram({ frets, barre = 0, dots = null, strings, label }) {
  const nS = strings, gapX = nS > 4 ? 12 : 16, W = 30 + (nS - 1) * gapX + 16, X = i => 22 + i * gapX, Y = j => 24 + j * 16;
  const all = dots ? dots.map(d => d.f) : frets.filter(f => f > 0);
  const maxF = Math.max(0, ...all), minF = all.filter(f => f > 0).length ? Math.min(...all.filter(f => f > 0)) : 1;
  const start = maxF <= 4 ? 1 : minF;
  let s = `<svg viewBox="0 0 ${W} 106" role="img" aria-label="Greep ${label}">`;
  for (let i = 0; i < nS; i++) s += `<line x1="${X(i)}" y1="${Y(0)}" x2="${X(i)}" y2="${Y(5)}" stroke="currentColor" stroke-width="1" opacity=".5"/>`;
  for (let j = 0; j <= 5; j++) s += `<line x1="${X(0)}" y1="${Y(j)}" x2="${X(nS - 1)}" y2="${Y(j)}" stroke="currentColor" stroke-width="${j === 0 && start === 1 ? 3.5 : 1}" opacity="${j === 0 && start === 1 ? 1 : .5}"/>`;
  if (start > 1) s += `<text x="3" y="${Y(0) + 12}" font-size="9" font-family="ui-monospace, monospace" fill="currentColor">${start}fr</text>`;
  if (dots) {
    for (const d of dots) {
      if (d.f === 0) { s += `<circle cx="${X(d.s)}" cy="${Y(0) - 9}" r="3.4" fill="none" stroke="currentColor" stroke-width="1.2"/>`; continue; }
      const cy = Y(d.f - start + 0.5), root = d.l === 'R';
      s += `<circle cx="${X(d.s)}" cy="${cy}" r="6" fill="${root ? 'var(--accent)' : 'currentColor'}"/>`;
      s += `<text x="${X(d.s)}" y="${cy + 3}" text-anchor="middle" font-size="7.5" font-weight="700" fill="var(--bg)">${d.l}</text>`;
    }
    return s + '</svg>';
  }
  if (barre) {
    const first = frets.findIndex(f => f >= 0), y = Y(barre - start + 0.5);
    s += `<rect x="${X(first) - 5}" y="${y - 5}" width="${X(nS - 1) - X(first) + 10}" height="10" rx="5" fill="currentColor"/>`;
  }
  frets.forEach((f, i) => {
    if (f < 0) s += `<text x="${X(i)}" y="${Y(0) - 6}" text-anchor="middle" font-size="10" fill="currentColor" opacity=".7">×</text>`;
    else if (f === 0) s += `<circle cx="${X(i)}" cy="${Y(0) - 9}" r="3.4" fill="none" stroke="currentColor" stroke-width="1.2"/>`;
    else if (!(barre && f === barre)) s += `<circle cx="${X(i)}" cy="${Y(f - start + 0.5)}" r="5" fill="currentColor"/>`;
  });
  return s + '</svg>';
}

/* ---------- SVG: piano (twee octaven, akkoord in grondligging) ---------- */
const WHITE = [0, 2, 4, 5, 7, 9, 11], BLACK = { 1: 0, 3: 1, 6: 3, 8: 4, 10: 5 }; // zwarte toets: na welke witte toets (index)
function pianoDiagram(root, q, flats, label) {
  const tones = INTERVALS[q].map(iv => root + iv); // absolute halve tonen vanaf C van octaaf 1
  const names = flats ? FLAT : SHARP;
  const kw = 14, kh = 52, W = 14 * kw + 2, H = kh + 4;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Piano ${label}">`;
  const marks = new Map(tones.map((t, i) => [t, i === 0 ? 'root' : 'tone']));
  // witte toetsen
  for (let i = 0; i < 14; i++) {
    const pc = WHITE[i % 7] + 12 * Math.floor(i / 7), m = marks.get(pc);
    const fill = m === 'root' ? 'var(--accent)' : m ? 'var(--tone)' : 'var(--key-w)';
    s += `<rect x="${1 + i * kw}" y="1" width="${kw - 1}" height="${kh}" rx="2" fill="${fill}" stroke="var(--key-line)" stroke-width="1"/>`;
    if (m) s += `<text x="${1 + i * kw + kw / 2}" y="${kh - 5}" text-anchor="middle" font-size="7.5" font-weight="700" fill="var(--bg)">${names[pc % 12]}</text>`;
  }
  // zwarte toetsen
  for (let oct = 0; oct < 2; oct++) for (const [pcS, after] of Object.entries(BLACK)) {
    const pc = +pcS + 12 * oct, i = after + 7 * oct, m = marks.get(pc);
    const fill = m === 'root' ? 'var(--accent)' : m ? 'var(--tone)' : 'var(--key-b)';
    const x = 1 + (i + 1) * kw - 4.5;
    s += `<rect x="${x}" y="1" width="9" height="${kh * 0.62}" rx="1.5" fill="${fill}" stroke="var(--key-line)" stroke-width="1"/>`;
    if (m) s += `<text x="${x + 4.5}" y="${kh * 0.62 - 4}" text-anchor="middle" font-size="6" font-weight="700" fill="var(--bg)">${names[pc % 12]}</text>`;
  }
  return s + '</svg>';
}

/* ---------- publiek ---------- */
function render(instrument, ch, { shift = 0, flats = false, label = '' } = {}) {
  if (!ch) return `<svg viewBox="0 0 90 60" role="img" aria-label="Geen akkoord"><text x="45" y="36" text-anchor="middle" font-size="12" fill="currentColor" opacity=".5">N.C.</text></svg>`;
  const root = mod12(ch.root + shift);
  if (instrument === 'piano') return pianoDiagram(root, ch.q, flats, label);
  if (instrument === 'guitar') { const g = guitarShape(root, ch.q); return fretDiagram({ ...g, strings: 6, label }); }
  if (instrument === 'ukulele') { const u = ukuleleShape(root, ch.q); return fretDiagram({ ...u, strings: 4, label }); }
  if (instrument === 'bass') { const b = bassShape(root, ch.q); return fretDiagram({ dots: b.dots, strings: 4, label }); }
  return '';
}
const hasCapo = id => id === 'guitar' || id === 'ukulele';

return { LIST, STRING_NAMES, render, hasCapo };
})();
